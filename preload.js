"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  wardrobe: {
    list:   ()           => ipcRenderer.invoke("wardrobe:list"),
    save:   (entry)      => ipcRenderer.invoke("wardrobe:save", entry),
    delete: (id)         => ipcRenderer.invoke("wardrobe:delete", id),
    rename: (id, name)   => ipcRenderer.invoke("wardrobe:rename", { id, name }),
  },
  bc: {
    path: () => ipcRenderer.invoke("bc:path"),
  },
  plugins: {
    list:       ()     => ipcRenderer.invoke("plugins:list"),
    openFolder: ()     => ipcRenderer.invoke("plugins:openFolder"),
    delete:     (name) => ipcRenderer.invoke("plugins:delete", name),
  },
  lang: {
    list:       ()     => ipcRenderer.invoke("lang:list"),
    get:        (code) => ipcRenderer.invoke("lang:get", code),
    openFolder: ()     => ipcRenderer.invoke("lang:openFolder"),
  },
  // Native menu → renderer: open the in-app Settings panel
  onOpenSettings: (cb) => ipcRenderer.on("open-settings", () => cb()),
});
