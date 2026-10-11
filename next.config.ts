import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static files for the Tauri app (src-tauri/tauri.conf.json frontendDist).
  output: "export",
  images: { unoptimized: true },
  reactCompiler: true,
};

export default nextConfig;
