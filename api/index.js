import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createStudyService } from "./study-core.mjs";

let servicePromise;

async function getService() {
  if (!servicePromise) {
    servicePromise = (async () => {
      if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
        throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
      }
      const dataPath = path.join(process.cwd(), "build", "word_entries.json");
      const payload = JSON.parse(await readFile(dataPath, "utf8"));
      const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
      const service = createStudyService({ db, entries: payload.entries });
      await service.init();
      return service;
    })();
  }
  return servicePromise;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  try {
    const service = await getService();
    const url = new URL(req.url, "https://" + (req.headers.host ?? "localhost"));
    const route = url.pathname.replace(/^\/api\/?/, "");
    if (req.method === "GET" && route === "meta") return send(res, 200, await service.meta());
    if (req.method === "GET" && route === "students") return send(res, 200, { students: await service.listStudents() });
    if (req.method === "GET" && route === "student/summary") return send(res, 200, await service.summary(Number(url.searchParams.get("studentId") ?? 0)));
    if (req.method === "POST" && route === "login") return send(res, 200, await service.login((await readJson(req)).name));
    if (req.method === "POST" && route === "session") return send(res, 200, await service.session(await readJson(req)));
    if (req.method === "POST" && route === "answer") return send(res, 200, await service.answer(await readJson(req)));
    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 400, { error: error.message || "请求失败" });
  }
}
