import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ChatPluginBootstrap } from "@/components/chat-plugin-bootstrap";
import { ChatReasoningVisibilityController } from "@/components/chat-reasoning-visibility-controller";
import { CSSImportEnhancer } from "@/components/css-import-enhancer";
import { PWAManifestInjector } from "@/components/pwa-manifest-injector";
import { PWARegistrar } from "@/components/pwa-registrar";
import { GestureController } from "@/components/gesture-controller";
import "../styles/fonts.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "float",
  description: "float",
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 开屏前定好深/浅（data-theme）和工具栏布局（data-wx-toolbar），避免刷新闪白。
            深浅：手动选过就按手动，没选就跟随系统，系统切换时实时跟着变。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement,q=window.matchMedia('(prefers-color-scheme: dark)');function a(){var m=localStorage.getItem('float-theme-mode');d.setAttribute('data-theme',(m==='dark'||m==='light')?m:(q.matches?'dark':'light'));}a();if(q.addEventListener){q.addEventListener('change',a);}if(localStorage.getItem('float-wx-toolbar')==='on'){d.setAttribute('data-wx-toolbar','on');}}catch(e){}})();",
          }}
        />
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <meta name="theme-color" content="#f8f7f2" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="float" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <PWAManifestInjector />
        <PWARegistrar />
        <CSSImportEnhancer />
        <ChatPluginBootstrap />
        <ChatReasoningVisibilityController />
        <GestureController />
        {children}
      </body>
    </html>
  );
}
