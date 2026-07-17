// packages/work/src/remote-dev/index.ts
// VRAXIA Remote Development Agent — public exports + server integration

export { createRdaRouter }       from './router/rda-router.js';
export { initRdaWsServer,
         broadcastJobEvent,
         dispatchJobToAgent,
         getConnectedAgents }    from './ws/rda-ws-server.js';
export { initRdaSchema }         from './db/repository.js';
export { ExecutorRegistry }      from './executor/registry.js';
export type * from './types/index.js';
