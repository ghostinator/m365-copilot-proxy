import { clientErrorResponse, responseHeaders, type Wire } from './client-adapter-types.js';

type Protocol = 'responses' | 'messages';
const tokenUsage=(u:Wire|undefined,p:Protocol):Wire|null=>u?{input_tokens:u.prompt_tokens??0,output_tokens:u.completion_tokens??0,...(p==='responses'?{total_tokens:u.total_tokens??((u.prompt_tokens??0)+(u.completion_tokens??0))}:{})}:null;

function outputItems(message: Wire, custom: Set<string>): Wire[] {
  const output:Wire[]=[];
  if(message.content) output.push({id:`msg_${crypto.randomUUID()}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:message.content,annotations:[]}]});
  for(const call of message.tool_calls??[]) {
    if(custom.has(call.function.name)) {
      const value=JSON.parse(call.function.arguments);
      if(typeof value.input!=='string') throw new Error('Custom tool input must be a string');
      output.push({id:`ct_${call.id}`,type:'custom_tool_call',call_id:call.id,name:call.function.name,input:value.input,status:'completed'});
    } else output.push({id:`fc_${call.id}`,type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments,status:'completed'});
  }
  return output;
}
function messageBlocks(message:Wire):Wire[] {
  const blocks:Wire[]=[];
  if(message.content) blocks.push({type:'text',text:message.content});
  for(const call of message.tool_calls??[]) blocks.push({type:'tool_use',id:call.id,name:call.function.name,input:JSON.parse(call.function.arguments)});
  return blocks;
}

export async function adaptProtocolResponse(source:Response,protocol:Protocol,model:string,ignored:string[],custom=new Set<string>()):Promise<Response> {
  const headers=responseHeaders(source,ignored,source.headers.get('content-type')?.includes('text/event-stream'));
  if(!source.ok) {
    let error:unknown;try{error=await source.json();}catch{error={message:`Upstream request failed (${source.status})`};}
    return clientErrorResponse(error,protocol,source.status,headers);
  }
  const id=`${protocol==='responses'?'resp':'msg'}_${crypto.randomUUID()}`;
  const created=Math.floor(Date.now()/1000);
  const responseObject=(output:Wire[],status='completed',usage:Wire|null=null):Wire=>({id,object:'response',created_at:created,model,status,error:null,incomplete_details:status==='incomplete'?{reason:'max_output_tokens'}:null,output,usage,parallel_tool_calls:false,tool_choice:'auto',tools:[]});
  const messageObject=(content:Wire[],stop_reason:string|null,usage:Wire|null):Wire=>({id,type:'message',role:'assistant',model,content,stop_reason,stop_sequence:null,usage:usage??{input_tokens:0,output_tokens:0}});
  if(!source.headers.get('content-type')?.includes('text/event-stream')) {
    try {
      const chat=await source.json() as Wire;
      if(chat.error) return clientErrorResponse(chat,protocol,502,headers);
      const choice=chat.choices?.[0];
      if(!choice?.message) throw new Error('Malformed Chat Completions response');
      if(typeof chat.model==='string')model=chat.model;
      const result=protocol==='responses'?responseObject(outputItems(choice.message,custom),choice.finish_reason==='length'?'incomplete':'completed',tokenUsage(chat.usage,protocol)):messageObject(messageBlocks(choice.message),choice.finish_reason==='tool_calls'?'tool_use':choice.finish_reason==='length'?'max_tokens':'end_turn',tokenUsage(chat.usage,protocol));
      return Response.json(result,{headers,status:source.status});
    } catch {return clientErrorResponse({message:'Malformed upstream response'},protocol,502,headers);}
  }
  if(!source.body) return clientErrorResponse({message:'Missing upstream stream'},protocol,502,headers);
  const reader=source.body.getReader(); const decoder=new TextDecoder('utf-8',{fatal:true}); const encoder=new TextEncoder();
  let buffer=''; let started=false; let closed=false; let cancelled=false; let sequence=0; let finish:string|null=null;let usage:Wire|undefined;
  let upstreamError:Wire|undefined;
  let text='';let textIndex:number|undefined;let textId=''; const calls=new Map<number,Wire>(); const output:Wire[]=[];
  const queue:Uint8Array[]=[];
  const event=(type:string,data:Wire)=>queue.push(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(protocol==='responses'?{...data,type,sequence_number:sequence++}:{...data,type})}\n\n`));
  const start=()=>{
    if(started)return;started=true;
    if(protocol==='responses') {event('response.created',{response:responseObject([],'in_progress')});event('response.in_progress',{response:responseObject([],'in_progress')});}
    else event('message_start',{message:messageObject([],null,{input_tokens:0,output_tokens:0})});
  };
  const startText=()=>{
    if(textIndex!==undefined)return;
    textIndex=output.length;textId=`msg_${crypto.randomUUID()}`;
    const item={id:textId,type:'message',role:'assistant',status:'in_progress',content:[]};output.push(item);
    if(protocol==='responses'){event('response.output_item.added',{output_index:textIndex,item});event('response.content_part.added',{item_id:textId,output_index:textIndex,content_index:0,part:{type:'output_text',text:'',annotations:[]}});}
    else event('content_block_start',{index:textIndex,content_block:{type:'text',text:''}});
  };
  const complete=()=>{
    if(!finish)throw new Error('Upstream stream ended without a finish reason');
    if(textIndex!==undefined){
      const part={type:'output_text',text,annotations:[]}; const item={...output[textIndex],status:'completed',content:[part]};output[textIndex]=item;
      if(protocol==='responses'){event('response.output_text.done',{item_id:textId,output_index:textIndex,content_index:0,text});event('response.content_part.done',{item_id:textId,output_index:textIndex,content_index:0,part});event('response.output_item.done',{output_index:textIndex,item});}
      else event('content_block_stop',{index:textIndex});
    }
    for(const call of calls.values()) {
      if(!call.id||!call.function.name)throw new Error('Malformed tool call in upstream stream');
      JSON.parse(call.function.arguments);
      const index=output.length;
      if(protocol==='responses') {
        const item=outputItems({tool_calls:[call]},custom)[0];output.push(item);
        const isCustom=item.type==='custom_tool_call';const field=isCustom?'input':'arguments';const prefix=isCustom?'response.custom_tool_call_input':'response.function_call_arguments';
        event('response.output_item.added',{output_index:index,item:{...item,status:'in_progress',[field]:''}});
        event(`${prefix}.delta`,{item_id:item.id,output_index:index,delta:item[field]});
        event(`${prefix}.done`,{item_id:item.id,output_index:index,[field]:item[field],...(isCustom?{}:{name:item.name})});
        event('response.output_item.done',{output_index:index,item});
      } else {
        event('content_block_start',{index,content_block:{type:'tool_use',id:call.id,name:call.function.name,input:{}}});
        event('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:call.function.arguments}});
        event('content_block_stop',{index});output.push(call);
      }
    }
    if(protocol==='responses')event(finish==='length'?'response.incomplete':'response.completed',{response:responseObject(output,finish==='length'?'incomplete':'completed',tokenUsage(usage,protocol))});
    else {event('message_delta',{delta:{stop_reason:finish==='tool_calls'?'tool_use':finish==='length'?'max_tokens':'end_turn',stop_sequence:null},usage:tokenUsage(usage,protocol)??{output_tokens:0}});event('message_stop',{});}
    closed=true;
  };
  const frame=(raw:string)=>{
    const data=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data){if(protocol==='messages')event('ping',{});else queue.push(encoder.encode(': keepalive\n\n'));return;}
    if(data==='[DONE]'){complete();return;}
    const chunk=JSON.parse(data);
    if(chunk.error){upstreamError=chunk.error;throw new Error(chunk.error.message??'Upstream stream failed');}
    if(!Array.isArray(chunk.choices))throw new Error('Malformed upstream stream frame');
    if(chunk.usage)usage=chunk.usage;
    for(const choice of chunk.choices){
      if(choice.index!==undefined&&choice.index!==0)throw new Error('Multiple stream choices are not supported');
      if(choice.finish_reason)finish=choice.finish_reason;
      const delta=choice.delta??{};
      if(delta.content){if(typeof delta.content!=='string')throw new Error('Malformed text delta');startText();text+=delta.content;
        if(protocol==='responses')event('response.output_text.delta',{item_id:textId,output_index:textIndex,content_index:0,delta:delta.content,logprobs:[]});
        else event('content_block_delta',{index:textIndex,delta:{type:'text_delta',text:delta.content}});
      }
      for(const tc of delta.tool_calls??[]) {
        if(!Number.isInteger(tc.index))throw new Error('Missing tool call index');
        const call=calls.get(tc.index)??{id:'',type:'function',function:{name:'',arguments:''}};
        if(tc.id)call.id+=tc.id;if(tc.function?.name)call.function.name+=tc.function.name;if(tc.function?.arguments)call.function.arguments+=tc.function.arguments;
        calls.set(tc.index,call);
      }
      if(!delta.content&&!delta.tool_calls&&!choice.finish_reason){if(protocol==='messages')event('ping',{});else queue.push(encoder.encode(': keepalive\n\n'));}
    }
  };
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      if(cancelled)return;
      try {
        start();
        while(!queue.length&&!closed){
          const boundary=buffer.indexOf('\n\n');
          if(boundary>=0){const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);frame(raw);continue;}
          const read=await reader.read();if(cancelled)return;
          if(read.done){buffer+=decoder.decode();throw new Error('Upstream stream ended before [DONE]');}
          buffer+=decoder.decode(read.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
        }
      }catch(error){
        if(cancelled)return;
        const message=error instanceof SyntaxError?'Malformed upstream stream frame':error instanceof Error?error.message:'Upstream stream failed';
        const details=upstreamError?.details===undefined?{}:{details:upstreamError.details};
        const code=upstreamError?.code??'upstream_stream_error';
        event('error',protocol==='messages'?{error:{type:'api_error',message,code,...details}}:{code,message,param:null,...details});
        closed=true;void reader.cancel(error).catch(()=>{});
      }
      const next=queue.shift();if(next)controller.enqueue(next);
      if(closed&&!queue.length){controller.close();void reader.cancel().catch(()=>{});}
    },
    cancel(reason){cancelled=true;closed=true;return reader.cancel(reason);},
  });
  return new Response(stream,{status:source.status,headers});
}
