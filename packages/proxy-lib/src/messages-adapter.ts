import { ChatCompletionRequest } from './schemas.js';
import { adaptProtocolResponse } from './protocol-stream.js';
import { ignoredControls, invalid, list, object, rejectFields, string, validateHistory, type ClientAdapterRequest, type Wire } from './client-adapter-types.js';

// Copilot cannot compile "$schema" (Claude Code puts it on every tool schema); drop it at any depth.
// Keys of property maps are names, not keywords, so a property literally called "$schema" survives.
const SCHEMA_MAPS=new Set(['properties','patternProperties','$defs','definitions']);
export function stripSchemaKeyword(node:any, isMap=false):any {
  if(Array.isArray(node)) return node.map(item=>stripSchemaKeyword(item));
  if(!node||typeof node!=='object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key])=>isMap||key!=='$schema').map(([key,child])=>[key,stripSchemaKeyword(child,!isMap&&SCHEMA_MAPS.has(key))]));
}

export function parseMessagesRequest(value: unknown): ClientAdapterRequest {
  const input=object(value,'request');
  // Claude Code (2026) can send {role:"system"} turns inside messages; fold them into the top-level system.
  if(Array.isArray(input.messages)&&input.messages.some((m:any)=>m?.role==='system')) {
    const extra:string[]=[];
    input.messages=input.messages.filter((m:any)=>{
      if(m?.role!=='system') return true;
      extra.push(typeof m.content==='string'?m.content:(Array.isArray(m.content)?m.content:[]).map((b:any)=>b?.text??'').join('\n'));
      return false;
    });
    const sys=typeof input.system==='string'?[{type:'text',text:input.system}]:Array.isArray(input.system)?input.system:[];
    input.system=[...sys,...extra.map(text=>({type:'text',text}))];
  }
  // context_management is Anthropic-only: ignored rather than refused.
  rejectFields(input,['container','mcp_servers','betas']);
  if(input.output_config?.format) invalid('Structured output formats are not supported');
  const messages: Wire[]=[];
  const part=(raw:unknown):Wire=>{
    const p=object(raw,'content block');
    if(p.type==='text') return {type:'text',text:string(p.text,'text')};
    if(p.type==='image') {
      const source=object(p.source,'image source');
      if(source.type==='url') return {type:'image_url',image_url:{url:string(source.url,'image URL')}};
      if(source.type==='base64') return {type:'image_url',image_url:{url:`data:${string(source.media_type,'media_type')};base64,${string(source.data,'image data')}`}};
    }
    invalid(`Unsupported Messages content: ${p.type}`);
  };
  if(input.system!==undefined) messages.push({role:'system',content:typeof input.system==='string'?input.system:list(input.system,'system').map(part)});
  for(const raw of list(input.messages,'messages')) {
    const message=object(raw,'message');
    if(!['user','assistant'].includes(message.role)) invalid('Messages role must be user or assistant');
    if(typeof message.content==='string') { messages.push({role:message.role,content:message.content}); continue; }
    let blocks: Wire[]=[]; let calls:Wire[]=[];
    const flush=()=>{if(blocks.length||calls.length) messages.push({role:message.role,content:blocks.length?blocks:null,...(calls.length?{tool_calls:calls}:{})});blocks=[];calls=[];};
    let sawContent=false;
    for(const rawBlock of list(message.content,'message content')) {
      const block=object(rawBlock,'content block');
      if(block.type==='tool_use') {
        if(message.role!=='assistant') invalid('tool_use requires assistant role');
        calls.push({id:string(block.id,'tool ID'),type:'function',function:{name:string(block.name,'tool name'),arguments:JSON.stringify(object(block.input,'tool input'))}});
      } else if(block.type==='thinking'||block.type==='redacted_thinking') {
        continue;
      } else if(block.type==='tool_result') {
        if(message.role!=='user'||sawContent) invalid('tool_result must precede user content');
        flush();
        const result=typeof block.content==='string'?block.content:block.content===undefined?'':list(block.content,'tool result content').map(part);
        const content=block.is_error ? [{type:'text',text:'Tool execution failed:'},...(typeof result==='string'?[{type:'text',text:result}]:result)] : result;
        messages.push({role:'tool',tool_call_id:string(block.tool_use_id,'tool_use_id'),content});
      } else {sawContent=true;blocks.push(part(block));}
    }
    flush();
  }
  validateHistory(messages);
  const tools=input.tools===undefined?undefined:list(input.tools,'tools').map(raw=>{const t=object(raw,'tool');if(t.type&&t.type!=='custom') invalid('Native vendor tools are not supported');return {type:'function',function:{name:string(t.name,'tool name'),description:t.description,parameters:stripSchemaKeyword(t.input_schema)}};});
  let choice:unknown;
  if(input.tool_choice!==undefined) {
    const c=object(input.tool_choice,'tool_choice');
    if(c.type==='tool') choice={type:'function',function:{name:string(c.name,'tool_choice name')}};
    else if(c.type==='any') choice='required';
    else if(c.type==='auto'||c.type==='none') choice=c.type;
    else invalid('Unsupported tool_choice');
  }
  const body=ChatCompletionRequest.parse({model:input.model,messages,tools,tool_choice:choice,stream:input.stream,stream_options:{include_usage:true}});
  return {body,adapt:response=>adaptProtocolResponse(response,'messages',body.model,ignoredControls(input))};
}
