//Replaced with the following code for testing purposes

//import react from '@vitejs/plugin-react'
//import { defineConfig } from 'vite'

// https://vite.dev/config/
//

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    css: true,

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/main.jsx",
        "src/setupTests.js",
      ],
    },
  },
});
