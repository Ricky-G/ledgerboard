(function initializeLedgerBoardPreview() {
  "use strict";

  const PREVIEW_TITLE = "LedgerBoard preview";

  async function request(path, options) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Preview request failed with ${response.status}.`);
    }
    return payload;
  }

  function dispatch(data) {
    window.dispatchEvent(new MessageEvent("message", { data }));
  }

  async function loadState() {
    try {
      const bundle = await request("/api/state");
      dispatch({ type: "load", bundle });
    } catch (error) {
      dispatch({ type: "loadError", message: error.message });
    }
  }

  const vscode = {
    getState: () => null,
    setState: () => undefined,
    postMessage: (message) => {
      if (message.type === "ready" || message.type === "reload" || message.type === "normalize") {
        void loadState();
        return;
      }
      if (message.type === "save") {
        void request("/api/save", {
          method: "POST",
          body: JSON.stringify(message.request),
        }).then(
          (result) => dispatch({ type: "saveResult", result }),
          (error) => dispatch({ type: "saveError", message: error.message }),
        );
        return;
      }
      if (message.type === "selectBoard") {
        if (window.confirm("Reset the local preview to its original sample data?")) {
          void resetState();
        }
      }
    },
  };

  async function resetState() {
    try {
      const bundle = await request("/api/reset", {
        method: "POST",
        body: "{}",
      });
      dispatch({ type: "load", bundle });
    } catch (error) {
      dispatch({ type: "loadError", message: error.message });
    }
  }

  function addPreviewControls() {
    const controls = document.createElement("aside");
    controls.className = "preview-controls";
    controls.setAttribute("aria-label", "Local preview controls");

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Local sandbox";
    const detail = document.createElement("span");
    detail.textContent = "Repository files stay unchanged";
    copy.append(title, detail);

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload UI";
    reload.addEventListener("click", () => window.location.reload());

    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset data";
    reset.addEventListener("click", () => {
      if (window.confirm("Discard preview changes and restore the sample board?")) {
        void resetState();
      }
    });

    controls.append(copy, reload, reset);
    document.body.append(controls);
  }

  window.acquireVsCodeApi = () => vscode;
  window.addEventListener("DOMContentLoaded", addPreviewControls);

  const events = new EventSource("/events");
  events.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "reset") void loadState();
  });

  window.addEventListener("beforeunload", () => events.close());
  document.title = PREVIEW_TITLE;
})();
