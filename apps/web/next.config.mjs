import {fileURLToPath} from 'node:url';
/** @type {import('next').NextConfig} */
const config={output:'standalone',outputFileTracingRoot:fileURLToPath(new URL('../../',import.meta.url)),poweredByHeader:false,experimental:{cpus:2},async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*`}];},async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'},{key:'Content-Security-Policy',value:(process.env.NODE_ENV === 'development' ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " : "script-src 'self' 'unsafe-inline'; ") + "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}]}];}};
export default config;

