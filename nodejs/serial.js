const { SerialPort } = require("serialport");
const http = require("http");
const readline = require("readline");

const CMD_GET_CURRENT_mA = 0x00;
const CMD_SET_THRESHOLD = 0x01;
const ID_BROADCAST = 0x00;

// ===== CRC16 (Modbus) =====
function crc16(buf) {
  let crc = 0xFFFF;
  for (let b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc & 0xFFFF;
}

function crc16_modbus(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xFFFF;
}

function buildPacket(id, cmd, data) {
  data = data || []; // có thể null
  const len = 4 + data.length; // ID + CMD + DATA
  const payload = [len, id, cmd, ...data];

  const crc = crc16_modbus(Buffer.from(payload));
  const crc_h = (crc >> 8) & 0xFF;
  const crc_l = crc & 0xFF;

  return Buffer.from([0x02, ...payload, crc_h, crc_l, 0x03]);
}

function validatePacket(packet) {
  if (packet.length < 6) {
    console.log("❌ Packet quá ngắn");
    return false;
  }

  const stx = packet[0];
  const etx = packet[packet.length - 1];

  if (stx !== 0x02 || etx !== 0x03) {
    console.log("❌ Sai STX/ETX");
    return false;
  }

  // length theo protocol
  const len = packet[1];
  if (packet.length !== len + 5) {
    console.log(`❌ Sai độ dài: packet=${packet.length}, len=${len}`);
    //return false;
  }

  // tách CRC little-endian
  const crcLow = packet[packet.length - 2];
  const crcHigh = packet[packet.length - 3];
  const recvCrc = (crcHigh << 8) | crcLow;

  // dữ liệu cần tính CRC: từ LEN tới hết DATA
  const dataForCrc = packet.slice(1, packet.length - 3);
  const calcCrc = crc16(dataForCrc);

  console.log("🔎 Debug Packet:");
  console.log("  Raw:", [...packet].map(b => b.toString(16).padStart(2,"0")).join(" "));
  console.log("  LEN:", len);
  console.log("  CRC recv:", recvCrc.toString(16), " (hi:", crcHigh.toString(16), " lo:", crcLow.toString(16), ")");
  console.log("  CRC calc:", calcCrc.toString(16));

  if (recvCrc !== calcCrc) {
    console.log("❌ CRC mismatch!");
    return false;
  }

  console.log("✅ Packet hợp lệ");
  return true;
}


function questionAsync(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log("⚠️ Không tìm thấy COM port nào.");
    return;
  }

  console.log("Danh sách COM port:");
  ports.forEach((p, idx) => {
    console.log(`${idx + 1}) ${p.path} ${p.friendlyName || ""}`);
  });

  const ans = await questionAsync("Chọn cổng (số): ");
  const idx = Number(ans.trim()) - 1;
  if (idx < 0 || idx >= ports.length) {
    console.log("❌ Lựa chọn không hợp lệ.");
    return;
  }

  const serialPath = ports[idx].path;
  const baud = 115200;

  let recvBuffer = Buffer.alloc(0);
  let pendingResolver = null;
  let timeoutHandle = null;

  const port = new SerialPort({ path: serialPath, baudRate: baud, autoOpen: false });

  port.on("data", (chunk) => {
	const hexArray = [...chunk].map(b => b.toString(16).padStart(2, "0"));
	console.log("Received:", hexArray.join(" "));
	  
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 7) {
      const stx = recvBuffer.indexOf(0x02);
      const etx = recvBuffer.indexOf(0x03, stx + 1);
      if (stx === -1 || etx === -1) break;

      const packet = recvBuffer.slice(stx, etx + 1);
      recvBuffer = recvBuffer.slice(etx + 1);

      if (validatePacket(packet)) {
		if (pendingResolver) {
		  if (timeoutHandle) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		  }
          pendingResolver(packet);
          pendingResolver = null;
	    } else {
		  console.log("No Resolver");
		}
      } else {
		console.log("CRC failed");
	  }
    }
  });

  port.on("open", () => console.log(`✅ Opened ${serialPath} @${baud}`));
  port.on("error", (err) => console.error("⚠️ Serial error:", err.message));

  await new Promise((res, rej) => port.open((err) => (err ? rej(err) : res())));

  function sendAndWait(pkt, timeout = 100) {
    return new Promise((resolve) => {
      pendingResolver = (resp) => resolve(resp);
      port.write(pkt, (err) => {
        if (err) {
          console.error("❌ Write error:", err.message);
          pendingResolver = null;
          resolve(null);
        }
      });
      timeoutHandle = setTimeout(() => {
		console.log("Timeout");
        if (pendingResolver) {
          pendingResolver = null;
          resolve(null);
        }
      }, timeout);
    });
  }

	function sendNoWait(pkt) {
	  port.write(pkt, (err) => {
		if (err) console.error("❌ Write error:", err.message);
	  });
	}

  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/getStatus") {
      let results = [];
      for (let id = 1; id <= 5; id++) {
        const pkt = buildPacket(id, CMD_GET_CURRENT_mA);
		console.log("Sending:", id);
        const resp = await sendAndWait(pkt, 100);
		
        if (resp) {
			console.log("resp:", resp);
			const dataBytes = resp.slice(3, 7);
			const value = dataBytes.readFloatLE(0);
			console.log("(", id, ")", "Float value:", value.toFixed(2), "(mA)");
			let statusStr = "";
			if (value < 10) {
				statusStr = "notcharge";
			}else if (value < 300) {
				statusStr = "fullcharged";
			} else {
				statusStr = "charging";
			}
            results.push({ id, status: statusStr });
        } else {
		  console.log("(", id, ")", "Timeout!");
          results.push({ id, status: "timeout" });
        }
      }
	  console.log(results);
      const json = JSON.stringify({ results }, null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(json);
    }
    else if (req.method === "POST" && req.url === "/setThreshold") {
      // đọc body JSON
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const threshold = data.threshold;
          if (typeof threshold !== "number") {
            res.writeHead(400);
            res.end("Invalid threshold");
            return;
          }
		} catch (e) {
          res.writeHead(400);
          res.end("Invalid JSON");
		  return;
        }

		try {
          const pkt = buildPacket(ID_BROADCAST, CMD_SET_THRESHOLD);
          sendNoWait(pkt);

		  res.writeHead(200, { "Content-Type": "application/json" });
		  res.end(JSON.stringify({ status: "success" }));
        } catch (e) {
          res.writeHead(400);
          res.end("Send failed");
        }
      });
    }
    else if (req.method === "POST" && req.url === "/getCurrentmA") {
      // đọc body JSON
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const id = data.id;
          if (typeof id !== "number") {
            res.writeHead(400);
            res.end("Invalid id");
            return;
          }

          const pkt = buildPacket(id, CMD_GET_CURRENT_mA); // ví dụ cmd=0x20 cho getCurrentmA
          const resp = await sendAndWait(pkt, 100);
		  console.log("resp:", resp);
		  const dataBytes = resp.slice(3, 7);
		  const value = dataBytes.readFloatLE(0);
		  console.log("Float value:", value.toFixed(2));

          let result;
          if (resp) {
            result = { id, status: "ok", raw: resp.toString("hex") };
          } else {
            result = { id, status: "timeout" };
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(400);
          res.end("Invalid JSON");
        }
      });
    }

    else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  const PORT_HTTP = 3000;
  server.listen(PORT_HTTP, () => {
    console.log(`🌐 HTTP server listening on http://localhost:${PORT_HTTP}`);
  });
}

main();
