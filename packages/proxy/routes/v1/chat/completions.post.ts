import { handleClientApiEvent } from '../../../client-api-handler';

export default defineEventHandler(event => handleClientApiEvent(event.node.req, event.node.res, event.context.proxyActivity ?? undefined));
