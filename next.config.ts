import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static files for the Tauri app (src-tauri/tauri.conf.json frontendDist).
  output: "export",
  images: { unoptimized: true },
  reactCompiler: true,
  // The dev badge would cover the app window corner in `tauri dev`.
  devIndicators: false,
};

export default nextConfig;
