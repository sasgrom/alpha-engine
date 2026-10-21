import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { Toaster } from "@/components/ui/sonner"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
        {/* Global toast viewport (sonner): job accepted/completed/failed
            notifications are triggered from AppLayout's job watcher and from
            mutation handlers across pages. */}
        <Toaster theme="dark" position="bottom-right" toastOptions={{ className: "t-mono text-[11px]" }} />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
