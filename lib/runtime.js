// Public build metadata, never credential values.
export const APP_REVISION = 'gemini-stable-api-fallback-v2';
export function runtimeInfo() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    app_revision: APP_REVISION,
    deployment_commit: typeof commit === 'string' && /^[a-f0-9]{40}$/i.test(commit) ? commit.slice(0, 7) : null
  };
}
