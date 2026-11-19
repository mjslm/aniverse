import { isYouTubeSource, youTubeEmbedURL } from "./preview-source.js";
let apiPromise;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      apiPromise = null;
      reject(new Error("The preview player could not connect."));
    }, 12e3);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      apiPromise = null;
      script.remove();
      reject(new Error("The preview player could not connect."));
    };
    document.head.append(script);
  });
  return apiPromise;
}
export // Keep provider controls intact and cap the sample at sixty seconds.
function mountYouTube(container, source, { autoplay = false, resume = 0, onProgress = () => {
}, onReady = () => {
}, onEnd = () => {
}, onError = () => {
} } = {}) {
  if (!isYouTubeSource(source)) throw new Error("Invalid preview source.");
  let instance, frame, disposed = false, ready = false, timer, readyTimeout, lastSave = 0, lastTime = 0, stalledAt = 0, failed = false, ended = false, actualLimit = source.previewSeconds || 60;
  const box = document.createElement("div");
  box.className = "youtube-container";
  container.append(box);
  const safeTime = () => Math.max(0, Math.min(actualLimit, Number(instance?.getCurrentTime?.()) || 0));
  const save = (force) => {
    if (!ready) return;
    const now = Date.now();
    if (force || now - lastSave > 2e3) {
      lastSave = now;
      onProgress({ seconds: safeTime(), duration: actualLimit, completed: ended });
    }
  };
  const fail = (error) => {
    if (disposed || failed) return;
    failed = true;
    clearInterval(timer);
    clearTimeout(readyTimeout);
    try {
      instance?.destroy();
    } catch {
    }
    box.remove();
    onError(error);
  };
  (async () => {
    try {
      const YT = await loadAPI();
      if (disposed) return;
      frame = document.createElement("iframe");
      frame.id = "youtube-" + crypto.randomUUID();
      frame.title = source.title + " — up to 60 second preview";
      frame.src = youTubeEmbedURL(source, location.origin);
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      box.append(frame);
      readyTimeout = setTimeout(() => fail(new Error("The preview player did not respond. Open the original video or try again.")), 15e3);
      instance = new YT.Player(frame, { events: {
        onReady: () => {
          if (disposed) return;
          clearTimeout(readyTimeout);
          ready = true;
          actualLimit = Math.min(source.previewSeconds || 60, instance.getDuration() || 60);
          if (resume > 0 && resume < actualLimit - 1) instance.seekTo(resume, true);
          onReady();
          if (autoplay) instance.playVideo();
          timer = setInterval(() => {
            if (disposed || failed) return;
            actualLimit = Math.min(source.previewSeconds || 60, instance.getDuration() || 60);
            const current = Number(instance.getCurrentTime()) || 0, state = instance.getPlayerState();
            if ([1, 3].includes(state) && Math.abs(current - lastTime) < 0.01) {
              stalledAt ||= Date.now();
              if (Date.now() - stalledAt > 18e3) {
                fail(new Error("Streaming has not started. Retry the preview or open the original video."));
                return;
              }
            } else stalledAt = 0;
            lastTime = current;
            if (!ended && safeTime() >= actualLimit - 0.15) {
              ended = true;
              instance.pauseVideo();
              save(true);
              onEnd();
            } else save(false);
          }, 350);
        },
        onStateChange: (event) => {
          if (disposed) return;
          if (event.data === 0 && !ended) {
            ended = true;
            save(true);
            onEnd();
          } else if (event.data === 2) save(true);
          else if (event.data === 1) {
            if (ended) {
              ended = false;
              instance.seekTo(0, true);
            }
            save(true);
          }
        },
        onError: (event) => fail(new Error([101, 150].includes(event.data) ? "The publisher does not allow this preview to be embedded." : "This preview is unavailable here."))
      } });
    } catch (error) {
      fail(error);
    }
  })();
  return { play() {
    if (ended) {
      instance?.seekTo?.(0, true);
      ended = false;
    }
    if (instance?.getPlayerState?.() === 1) instance.pauseVideo();
    else instance?.playVideo?.();
  }, seek(seconds) {
    instance?.seekTo?.(Math.max(0, Math.min(actualLimit - 0.25, safeTime() + seconds)), true);
  }, destroy() {
    if (disposed) return;
    save(true);
    disposed = true;
    clearInterval(timer);
    clearTimeout(readyTimeout);
    try {
      instance?.destroy();
    } catch {
    }
    box.remove();
  } };
}
