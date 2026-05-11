const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html", ".js": "application/javascript",
  ".json": "application/json", ".xml": "application/xml",
  ".css": "text/css", ".png": "image/png",
  ".properties": "text/plain"
};

const PORT = 8080;
const ROOT = __dirname;

http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(data);
  });
}).listen(PORT, () => console.log("Portfolio server: http://localhost:" + PORT));
