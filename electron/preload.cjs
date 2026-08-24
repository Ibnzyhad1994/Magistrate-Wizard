const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("magistrateWizard", {
  isElectron: true,
  startGoogleOAuth: (authUrl) => ipcRenderer.invoke("google-oauth-loopback", authUrl),
});
