import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security Layer 1: Helmet (Headers)
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Security Layer 2: Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: "Too many requests, please try again later." }
  });
  app.use("/api/", limiter);

  app.use(express.json({ limit: '10mb' }));

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Startup Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] Port: ${PORT}`);
    console.log(`[SERVER] Working Directory: ${process.cwd()}`);
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
    
    if (process.env.NODE_ENV === "production") {
      const distPath = path.join(process.cwd(), 'dist');
      console.log(`[SERVER] Production Mode: Serving static files from ${distPath}`);
    } else {
      console.log(`[SERVER] Development Mode: Vite middleware is active`);
    }
  });
}

startServer();
