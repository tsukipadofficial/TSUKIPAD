import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The waitlist is gone. Links to it are still out on X, so send them home
  // (the query string, and with it any `?ref=`, carries across).
  async redirects() {
    return [{ source: "/waitlist", destination: "/", permanent: false }];
  },
};

export default nextConfig;
