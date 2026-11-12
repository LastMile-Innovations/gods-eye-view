/** Restore hosted sessions; the loopback development profile connects without user-entered secrets. */
export async function restoreWorkspaceSession(api, signal) {
  let session = await api.session(signal);
  if (!session.paired && session.mode === 'local-development') {
    await api.connectLocal();
    session = await api.session(signal);
  }
  return session;
}
