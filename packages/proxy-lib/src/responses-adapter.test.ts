import { describe, expect, it } from 'vitest';
import { parseResponsesRequest } from './responses-adapter.js';
import { parseMessagesRequest } from './messages-adapter.js';
import { clientErrorResponse } from './client-adapter-types.js';

describe('client wire adapters', () => {
  it('translates Responses history without changing argument bytes', () => {
    const request = parseResponsesRequest({ model:'gpt-6-sol', instructions:'system', input:[
      {role:'user',content:[{type:'input_text',text:'look'},{type:'input_image',image_url:'data:image/png;base64,YQ=='}]},
      {type:'function_call',call_id:'call_a',name:'edit',arguments:'{ "s": "é\\n" }'},
      {type:'function_call_output',call_id:'call_a',output:' done\n'},
    ],tools:[{type:'function',name:'edit',parameters:{type:'object'}}],tool_choice:{type:'function',name:'edit'},temperature:0});
    expect(request.body.messages[2].tool_calls?.[0].function.arguments).toBe('{ "s": "é\\n" }');
    expect(request.body.messages[3]).toMatchObject({role:'tool',tool_call_id:'call_a',content:' done\n'});
    expect(request.body.messages[1].content).toEqual([{type:'text',text:'look'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]);
    expect(request.body.tool_choice).toEqual({type:'function',function:{name:'edit'}});
  });
  it('translates Messages tools, system and ordered results', () => {
    const {body}=parseMessagesRequest({model:'claude-sonnet',max_tokens:100,system:[{type:'text',text:'system'}],tools:[{name:'read',input_schema:{type:'object'}}],messages:[
      {role:'assistant',content:[{type:'tool_use',id:'a',name:'read',input:{file:'é'}},{type:'tool_use',id:'b',name:'read',input:{file:'b'}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'bad',is_error:true},{type:'tool_result',tool_use_id:'b',content:'ok'},{type:'text',text:'continue'}]},
    ],tool_choice:{type:'tool',name:'read'}});
    expect(body.messages.map(m=>m.role)).toEqual(['system','assistant','tool','tool','user']);
    expect(body.messages[2].content).toEqual([{type:'text',text:'Tool execution failed:'},{type:'text',text:'bad'}]);
  });
  it.each([['Responses',parseResponsesRequest,{input:'hi',previous_response_id:'resp_a'}],['Messages',parseMessagesRequest,{messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'missing',content:'x'}]}]}]])('rejects unsupported or unmatched %s history', (_name,parse,value)=>{
    expect(()=> (parse as typeof parseResponsesRequest)(value)).toThrow();
  });
  it('maps JSON replies and ignored controls',async()=>{
    const adapter=parseResponsesRequest({input:'hi',temperature:0,reasoning:{effort:'high'}});
    const result=await adapter.adapt(Response.json({id:'chat_a',model:'m',choices:[{message:{content:'hé'},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}));
    expect(result.headers.get('x-m365-ignored-controls')).toBe('temperature, reasoning');
    expect(await result.json()).toMatchObject({object:'response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'hé'}]}],usage:{input_tokens:4,output_tokens:2,total_tokens:6}});
  });
  const sse=(frames:unknown[])=>new Response(frames.map(frame=>`data: ${typeof frame==='string'?frame:JSON.stringify(frame)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  it.each(['responses', 'messages'])('reports the served fallback model in %s streams', async protocol => {
    const adapter = protocol === 'responses' ? parseResponsesRequest({ model: 'claude-opus', input: 'hi', stream: true })
      : parseMessagesRequest({ model: 'claude-opus', messages: [{ role: 'user', content: 'hi' }], stream: true });
    const response = await adapter.adapt(sse([
      { model: 'claude-opus', choices: [{ delta: { role: 'assistant' } }] },
      { model: 'claude-opus-4.5', choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }, '[DONE]',
    ]));
    const frames = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
    const model = protocol === 'responses' ? frames.at(-1).response.model : frames.find(frame => frame.type === 'message_start').message.model;
    expect(model).toBe('claude-opus-4.5');
  });
  it.each([['responses',parseResponsesRequest,{input:'hi',stream:true}],['messages',parseMessagesRequest,{messages:[{role:'user',content:'hi'}],stream:true}]])('streams %s text incrementally with native terminal events',async(protocol,parse,input)=>{
    const response=await parse(input).adapt(sse([{choices:[{index:0,delta:{content:'hé'}}]},{choices:[{index:0,delta:{content:'llo'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:8,completion_tokens:2}},'[DONE]']));
    const result=await response.text();
    expect(result).toContain(protocol==='responses'?'response.output_text.delta':'text_delta');
    expect(result).toContain('hé');
    expect(result).toContain(protocol==='responses'?'response.completed':'message_stop');
    expect(result).toContain('"input_tokens":8');
  });
  it('does not report successful stream completion after errors or truncation',async()=>{
    for(const source of [sse([{choices:[{delta:{content:'hello'}}]},{error:{message:'quota'}},'[DONE]']),sse([{choices:[{delta:{content:'hello'}}]}]),sse(['not-json'])]) {
      const result=await (await parseResponsesRequest({input:'hi',stream:true}).adapt(source)).text();
      expect(result).toContain('event: error');expect(result).not.toContain('event: response.completed');
    }
  });
  it('streams validated tools and custom plain text preserving input bytes',async()=>{
    const adapter=parseResponsesRequest({input:'hi',stream:true,tools:[{type:'custom',name:'shell',format:{type:'text'}}]});
    const input='echo "é"\n  hi\n';
    const response=await adapter.adapt(sse([{choices:[{delta:{tool_calls:[{index:0,id:'call_a',function:{name:'shell',arguments:JSON.stringify({input})}}]},finish_reason:'tool_calls'}]},'[DONE]']));
    const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
    expect(frames.find(f=>f.type==='response.custom_tool_call_input.delta')?.delta).toBe(input);
    expect(frames.at(-1).response.output[0]).toMatchObject({call_id:'call_a',input});
  });
  it('handles byte-split UTF8 and forwards cancellation',async()=>{
    let cancelled=false;
    const bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"é"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    let index=0;
    const stream=new ReadableStream({pull(c){if(index<bytes.length)c.enqueue(bytes.slice(index,++index));else c.close();},cancel(){cancelled=true;}});
    const result=await parseResponsesRequest({input:'hi',stream:true}).adapt(new Response(stream,{headers:{'content-type':'text/event-stream'}}));
    expect(await result.text()).toContain('é');
    const pending=new ReadableStream({cancel(){cancelled=true;}});
    cancelled=false;
    const next=await parseResponsesRequest({input:'hi',stream:true}).adapt(new Response(pending,{headers:{'content-type':'text/event-stream'}}));
    await next.body!.cancel('stop');expect(cancelled).toBe(true);
  });
  it('rejects unsupported tools, reasoning blocks and constrained formats',()=>{
    for(const request of [{input:'x',tools:[{type:'web_search'}]},{input:'x',tools:[{type:'custom',name:'x',format:{type:'grammar',syntax:'lark',definition:'x'}}]},{input:[{type:'reasoning',summary:[]}]},{input:'x',store:true}]) expect(()=>parseResponsesRequest(request)).toThrow();
    expect(()=>parseMessagesRequest({messages:[{role:'assistant',content:[{type:'thinking',thinking:'private'}]}]})).toThrow();
  });
  it('marks truncated Responses output incomplete in JSON and SSE',async()=>{
    const adapter=parseResponsesRequest({input:'hi'});
    const json=await adapter.adapt(Response.json({choices:[{message:{content:'cut'},finish_reason:'length'}]}));
    expect(await json.json()).toMatchObject({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}});
    const streamed=await adapter.adapt(sse([{choices:[{delta:{content:'cut'},finish_reason:'length'}]},'[DONE]']));
    expect(await streamed.text()).toContain('event: response.incomplete');
  });
  it('rejects stored prompts and structured output semantics',()=>{
    expect(()=>parseResponsesRequest({input:'x',prompt:{id:'pmpt_a'}})).toThrow();
    expect(()=>parseMessagesRequest({messages:[{role:'user',content:'x'}],output_config:{format:{type:'json_schema',schema:{type:'object'}}}})).toThrow();
  });
  it('coalesces adjacent assistant narration and function calls into one turn',()=>{
    const {body}=parseResponsesRequest({input:[{role:'user',content:'go'},{type:'message',role:'assistant',content:[{type:'output_text',text:'first'}]},{type:'function_call',call_id:'a',name:'run',arguments:'{ "x": 1 }'},{type:'message',role:'assistant',content:[{type:'output_text',text:'then'}]},{type:'function_call_output',call_id:'a',output:'okay'}]});
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toMatchObject({role:'assistant',content:[{type:'text',text:'first'},{type:'text',text:'then'}],tool_calls:[{id:'a',function:{arguments:'{ "x": 1 }'}}]});
  });
  it.each([[404,'not_found_error'],[413,'request_too_large'],[529,'overloaded_error']])('maps Messages HTTP %s',async(status,type)=>{
    const response=clientErrorResponse({error:{code:'upstream_code',message:'failed',details:{retryable:true}}},'messages',status,{'retry-after':'4'});
    expect(await response.json()).toMatchObject({type:'error',error:{type,code:'upstream_code',details:{retryable:true}}});
    expect(response.status).toBe(status);expect(response.headers.get('retry-after')).toBe('4');
  });
  it('retains structured upstream stream error codes and safe validation details',async()=>{
    const error={message:'Invalid generated tool arguments',code:'invalid_tool_arguments',details:[{path:'/file',reason:'must be string'}]};
    for(const parse of [parseResponsesRequest,parseMessagesRequest]) {
      const adapter=parse===parseResponsesRequest?parseResponsesRequest({input:'hi'}):parseMessagesRequest({messages:[{role:'user',content:'hi'}]});
      const result=await (await adapter.adapt(sse([{error}]))).text();
      expect(result).toContain('invalid_tool_arguments');expect(result).toContain('must be string');
      expect(result).not.toContain('event: response.completed');expect(result).not.toContain('event: message_stop');
    }
  });
  it('strips $schema from tool schemas at any depth but keeps a property named $schema', () => {
    const request = parseMessagesRequest({ model:'m', messages:[{role:'user',content:'hi'}], tools:[{ name:'Glob', description:'d', input_schema:{
      $schema:'https://json-schema.org/draft/2020-12/schema', type:'object', required:['pattern'],
      properties:{ pattern:{type:'string'}, $schema:{type:'string'}, list:{type:'array',items:{$schema:'x',type:'string'}}, either:{anyOf:[{$schema:'x',type:'string'},{type:'null'}]} },
      $defs:{ d:{$schema:'x',type:'integer'} },
    } }]});
    expect(request.body.tools?.[0].function.parameters).toEqual({
      type:'object', required:['pattern'],
      properties:{ pattern:{type:'string'}, $schema:{type:'string'}, list:{type:'array',items:{type:'string'}}, either:{anyOf:[{type:'string'},{type:'null'}]} },
      $defs:{ d:{type:'integer'} },
    });
  });
  it('folds system turns into system and ignores context_management and thinking blocks', () => {
    const request = parseMessagesRequest({ model:'m', system:'base', context_management:{edits:[]}, messages:[
      {role:'user',content:'hi'}, {role:'system',content:[{type:'text',text:'extra'}]},
      {role:'assistant',content:[{type:'thinking',thinking:'x',signature:'s'},{type:'text',text:'ok'}]},
    ]});
    expect(request.body.messages.map((m:any)=>m.role)).toEqual(['system','user','assistant']);
    expect(request.body.messages[0].content).toEqual([{type:'text',text:'base'},{type:'text',text:'extra'}]);
  });
});
