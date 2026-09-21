// Run from packages/nextjs when the local logo catalog changes.
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const logos = JSON.parse(await readFile("services/discover/logos.json", "utf8"));
const circles = await Promise.all(
  Object.entries(logos).map(async ([symbol, file], index) => {
    const data = await readFile(path.join("public", file));
    const column = index % 39,
      row = Math.floor(index / 39);
    return h(
      "div",
      {
        key: symbol,
        style: {
          display: "flex",
          position: "absolute",
          left: 10 + column * 29 + (row % 2) * 12,
          top: 16 + row * 27 + ((column * 17 + row * 7) % 23),
          width: 66,
          height: 66,
          borderRadius: 33,
          background: "white",
          border: "1px solid #e5e0ef",
          alignItems: "center",
          justifyContent: "center",
          transform: `rotate(${((index * 13) % 37) - 18}deg)`,
          boxShadow: "0 4px 10px rgba(40,24,80,0.10)",
        },
      },
      h("img", {
        src: `data:image/png;base64,${data.toString("base64")}`,
        width: 43,
        height: 43,
        style: { objectFit: "contain" },
      }),
    );
  }),
);
const response = new ImageResponse(
  h(
    "div",
    { style: { display: "flex", width: "100%", height: "100%", background: "transparent", overflow: "hidden" } },
    ...circles,
  ),
  { width: 1200, height: 198 },
);
await mkdir("public/og", { recursive: true });
await writeFile("public/og/stock-field.png", Buffer.from(await response.arrayBuffer()));
console.log(`Rendered ${circles.length} logos into public/og/stock-field.png`);
