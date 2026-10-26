import { ChatCompletionRequest } from './schemas.js';
import { adaptProtocolResponse } from './protocol-stream.js';
import { ignoredControls, invalid, list, object, rejectFields, string, validateHistory, type ClientAdapterRequest, type Wire } from './client-adapter-types.js';

export function parseResponsesRequest(value: unknown): ClientAdapterRequest {
  const input = object(value,'request');
  rejectFields(input,['previous_response_id','background','store','conversation','include','context_management','prompt']);
  if (input.text?.format && input.text.format.type !== 'text') invalid('Structured response formats are not supported');
  const custom = new Set<string>();
  const tools = input.tools === undefined ? undefined : list(input.tools,'tools').map(raw => {
    const tool = object(raw,'tool'); const name = string(tool.name,'tool name');
    if (tool.type === 'custom') {
      if (tool.format && tool.format.type !== 'text') invalid('Grammar-constrained custom tools are not supported');
      custom.add(name);
      return {type:'function',function:{name,description:tool.description,parameters:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:false}}};
    }
    if (tool.type !== 'function') invalid('Only function and plain-text custom tools are supported');
    return {type:'function',function:{name,description:tool.description,parameters:tool.parameters}};
  });
  const messages: Wire[] = [];
  if (input.instructions != null) messages.push({role:'system',content:string(input.instructions,'instructions')});
  const content = (v: unknown): any => typeof v === 'string' ? v : list(v,'content').map(raw => {
    const part = object(raw,'content part');
    if (part.type === 'input_text' || part.type === 'output_text') return {type:'text',text:string(part.text,'text')};
    if (part.type === 'input_image') {
      if (!part.image_url || part.file_id) invalid('Images require image_url; file IDs are not supported');
      return {type:'image_url',image_url:{url:string(part.image_url,'image_url')}};
    }
    invalid(`Unsupported Responses content: ${part.type}`);
  });
  if (typeof input.input === 'string') messages.push({role:'user',content:input.input});
  else for (const raw of list(input.input,'input')) {
    const item = object(raw,'input item');
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const call = {id:string(item.call_id,'call_id'),type:'function',function:{name:string(item.name,'name'),arguments:item.type === 'custom_tool_call' ? JSON.stringify({input:string(item.input,'custom input')}) : string(item.arguments,'arguments')}};
      const last = messages.at(-1);
      if (last?.role === 'assistant' && last.tool_calls) last.tool_calls.push(call);
      else messages.push({role:'assistant',content:null,tool_calls:[call]});
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') messages.push({role:'tool',tool_call_id:string(item.call_id,'call_id'),content:content(item.output)});
    else if (!item.type || item.type === 'message') {
      if (!['user','assistant','system','developer'].includes(item.role)) invalid('Unsupported message role');
      messages.push({role:item.role,content:content(item.content)});
    } else invalid(`Unsupported Responses input item: ${item.type}`);
  }
  const turns:Wire[]=[];
  for(const message of messages) {
    const previous=turns.at(-1);
    if(message.role==='assistant'&&previous?.role==='assistant') {
      const parts=(content:any):any[]=>content==null?[]:typeof content==='string'?[{type:'text',text:content}]:content;
      const merged=[...parts(previous.content),...parts(message.content)];
      previous.content=merged.length?merged:null;
      if(message.tool_calls)previous.tool_calls=[...(previous.tool_calls??[]),...message.tool_calls];
    } else turns.push(message);
  }
  validateHistory(turns);
  let choice = input.tool_choice;
  if (choice && typeof choice === 'object') {
    if (!['function','custom'].includes(choice.type)) invalid('Unsupported tool_choice');
    choice = {type:'function',function:{name:string(choice.name,'tool_choice name')}};
  }
  const body = ChatCompletionRequest.parse({model:input.model,messages:turns,tools,tool_choice:choice,stream:input.stream,stream_options:{include_usage:true}});
  return {body,adapt:response=>adaptProtocolResponse(response,'responses',body.model,ignoredControls(input),custom)};
}
