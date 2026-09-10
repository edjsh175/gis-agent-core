import { createBusinessArtifactRepository } from './repository.js';
import { createBusinessArtifactServer } from './server.js';
import { createPipelineStatisticsService } from './pipelineStatistics.js';

if (!process.argv.includes('--local-dev')) {
  console.error('Refusing to start without explicit --local-dev');
  process.exitCode = 1;
} else {
  const filename =
    process.env.BUSINESS_ARTIFACT_DB || '.business-artifacts/cards.sqlite';
  const repository = createBusinessArtifactRepository({ filename });
  const pipelineStatistics = createPipelineStatisticsService();
  const server = createBusinessArtifactServer({
    repository,
    pipelineStatistics,
    resolveContext: (req) => ({
      principalId: 'local-dev-principal',
      workspaceId: 'local-dev-workspace',
      workflowId:
        typeof req.headers['x-23dmaps-workflow-id'] === 'string' &&
        /^[A-Za-z0-9:_-]{1,128}$/.test(req.headers['x-23dmaps-workflow-id'])
          ? req.headers['x-23dmaps-workflow-id']
          : null,
    }),
  });
  const shutdown = () => {
    server.close(() => {
      repository.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('error', (error) => {
    console.error(
      `Unable to start business artifacts service: ${error.code || 'listen failed'}`
    );
    repository.close();
    process.exitCode = 1;
  });
  server.listen(3189, '127.0.0.1', () =>
    console.log(
      `Business artifacts listening at http://127.0.0.1:3189 (local-dev)`
    )
  );
}
