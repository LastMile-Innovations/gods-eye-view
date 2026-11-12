import { mountNeighborWorkspace } from './workspace/shell.js';
import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { t } from './i18n/index.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
  welcome: false,
  initialWorld: true,
});

const workspaceLifetime = new AbortController();
application.subscribe(({ status }) => {
  if (['destroying', 'destroyed', 'failed'].includes(status))
    workspaceLifetime.abort();
});
application
  .start()
  .then(({ scene }) => {
    mountNeighborWorkspace({
      application,
      viewer: scene.viewer,
      lifetime: workspaceLifetime.signal,
    });
  })
  .catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    loaderStatus.textContent = t('Error: {message}', {
      message: describeError(error),
    });
    loaderStatus.style.color = '#ff4444';
  });

export { application };
