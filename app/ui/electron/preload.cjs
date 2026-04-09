const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("kiosco", {});
