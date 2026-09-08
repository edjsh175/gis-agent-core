import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HARNESS_ROOT = process.env.DSH_HARNESS_ROOT || 'D:/deepseek-harness';
const HARNESS_PORT = 3188;

const moduleUrl = (relativePath) => pathToFileURL(path.join(HARNESS_ROOT, relativePath)).href;

async function main() {
  console.log('[Harness] Loading DeepSeek Harness modules from:', HARNESS_ROOT);
  const [
    cordis,
    llmModule,
    sessionModule,
    systemPromptModule,
    toolsModule,
    agentModule,
    agentLoopModule,
    webServerModule,
    userQuestionsModule,
    askUserModule,
    deepSeekModule,
    credentialsLocalModule,
  ] = await Promise.all([
    import(moduleUrl('vendor/cordis/lib/index.js')),
    import(moduleUrl('packages/llm/llm/lib/index.js')),
    import(moduleUrl('packages/core/session/lib/index.js')),
    import(moduleUrl('packages/core/system-prompt/lib/index.js')),
    import(moduleUrl('packages/core/tools/lib/index.js')),
    import(moduleUrl('packages/core/agent/lib/index.js')),
    import(moduleUrl('packages/core/agent-loop/lib/index.js')),
    import(moduleUrl('packages/host/webserver/lib/index.js')),
    import(moduleUrl('packages/interaction/user-questions/lib/index.js')),
    import(moduleUrl('packages/interaction/tool-ask-user/lib/index.js')),
    import(moduleUrl('packages/llm/llm-deepseek/lib/index.js')),
    import(moduleUrl('packages/credentials/credentials-local/lib/index.js')),
  ]);

  const gisRoot = path.resolve('harness/dsh-gis-plugin/src');
  const [service, pendingProvider, tools, policy, bridge] = await Promise.all([
    import(pathToFileURL(path.join(gisRoot, 'gisFrontendService.js')).href),
    import(pathToFileURL(path.join(gisRoot, 'pendingProvider.js')).href),
    import(pathToFileURL(path.join(gisRoot, 'gisTools.js')).href),
    import(pathToFileURL(path.join(gisRoot, 'gisAgentPolicy.js')).href),
    import(pathToFileURL(path.join(gisRoot, 'aguiBridge.js')).href),
  ]);

  const ctx = new cordis.Context();
  await ctx.plugin(llmModule.LlmRuntime);
  await ctx.plugin(sessionModule.SessionStore);
  await ctx.plugin(systemPromptModule.SystemPrompt);
  await ctx.plugin(toolsModule.ToolRuntime);
  await ctx.plugin(userQuestionsModule.UserQuestionService);
  await ctx.plugin(agentModule.AgentRegistry);
  await ctx.plugin(agentLoopModule.AgentLoop, { agents: [] });
  await ctx.plugin(webServerModule.WebServer, { host: '127.0.0.1', port: HARNESS_PORT });

  askUserModule.apply(ctx);
  service.apply(ctx);
  pendingProvider.apply(ctx);
  tools.apply(ctx);
  policy.apply(ctx);
  await ctx.plugin(credentialsLocalModule.default, { watch: false });
  deepSeekModule.apply(ctx, { thinking: 'enabled', reasoningEffort: 'high' });
  bridge.apply(ctx, { leaseMs: 300_000, provider: 'deepseek-official', model: 'deepseek-v4-flash' });

  console.log(`[Harness] DeepSeek GIS Agent service is active on http://127.0.0.1:${HARNESS_PORT}`);
  console.log('[Harness] Model: deepseek-official / deepseek-v4-flash (thinking enabled)');

  const shutdown = async () => {
    console.log('\n[Harness] Shutting down service...');
    await ctx.fiber.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Harness] Startup failed:', err);
  process.exit(1);
});
