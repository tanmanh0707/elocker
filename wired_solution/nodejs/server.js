const { SerialPort } = require("serialport");
const http = require("http");
const readline = require("readline");
const dgram = require('dgram');
const net = require('net');
const fs = require("fs");

const SENSOR_STATUS_NOT_CHARGE = 0;
const SENSOR_STATUS_CHARGING = 1;
const SENSOR_STATUS_FULL_CHARGED = 2;
const SENSOR_FULL_CHARGED_DELAY = 5;

const CU_DEVICE_ID = 0;

const UDP_PORT = 7792;
const UDP_BROADCAST_ADDR = '255.255.255.255';
const UDP_BROADCAST_PAYLOAD = 'Where are you, eLocker?';
const UDP_BROADCAST_INTERVAL_MS = 1000;

const LOCAL_IP = '0.0.0.0';

const TCP_RECONNECT_BASE_MS = 1000;
const TCP_RECONNECT_MAX_MS = 15000;

let udpSocket = null;
let udpBroadcastTimer = null;
let discoveredPeer = { ip: null, port: null };

let tcpSocket = null;
let tcpReconnectTimer = null;
let tcpReconnectDelay = TCP_RECONNECT_BASE_MS;

const CMD_GET_CURRENT_mA = 0x00;
const CMD_SET_THRESHOLD = 0x01;
const ID_BROADCAST = 0x00;

let sensorDevices = [];
let sensorResolver = null;
let sensorTimeoutHdl = null;

const WIRED_DEVICE_ID = [ 5, 6, 7, 8 ];

var MESS_CU_TEMP = [0x02, 0x00, 0x30, 0x03, 0x35];
var sensorThreshold = 200;  //mA
var notchargeThreshold = 100; //mA
var cuPort;
var ssPort;

const persistPath = "./store.json";

function loadStore() {
  if (fs.existsSync(persistPath)) {
    return JSON.parse(fs.readFileSync(persistPath, "utf8"));
  }
  return {};
}

function saveStore(data) {
  fs.writeFileSync(persistPath, JSON.stringify(data, null, 2), "utf8");
}

function  delay(time){
  return new Promise((resolve) => setTimeout(resolve, time))
}

// ===== UDP DISCOVERY =====
function startUdp() {
  udpSocket = dgram.createSocket('udp4');
  udpSocket.on('message', (msg, rinfo) => {
    if (msg.toString().trim() === 'Here I am, eLocker') {
      if (!discoveredPeer.ip) {
        discoveredPeer = { ip: rinfo.address, port: rinfo.port };
        console.log(`[UDP] Found peer ${discoveredPeer.ip}:${discoveredPeer.port}`);
        stopUdpBroadcast();
        connectTcp();
      }
    }
  });
  udpSocket.bind(UDP_PORT, LOCAL_IP, () => {
    udpSocket.setBroadcast(true);
    console.log('[UDP] Broadcasting...');
    udpBroadcastTimer = setInterval(() => {
      udpSocket.send(UDP_BROADCAST_PAYLOAD, UDP_PORT, UDP_BROADCAST_ADDR);
    }, UDP_BROADCAST_INTERVAL_MS);
  });
}
function stopUdpBroadcast() {
  if (udpBroadcastTimer) {
    clearInterval(udpBroadcastTimer);
    udpBroadcastTimer = null;
  }
}
// ==========================

// ===== TCP CLIENT =====
function sendTcp(obj) {
  try {
    if (tcpSocket && !tcpSocket.destroyed) {
      const payload = JSON.stringify(obj);
      tcpSocket.write(payload + "\n");
      console.log("Sent TCP:", payload);
    } else {
      console.warn("TCP socket is not connected");
    }
  } catch (err) {
    console.error("Failed to send TCP:", err.message);
  }
}

function connectTcp() {
  if (!discoveredPeer.ip) return;
  if (tcpSocket) { tcpSocket.destroy(); tcpSocket = null; }
  tcpSocket = new net.Socket();

  tcpSocket.on('connect', () => {
    console.log('[TCP] Connected');
    tcpReconnectDelay = TCP_RECONNECT_BASE_MS;
  });

  tcpSocket.on('data', (chunk) => {
    try {
      let tmpDevices = parseSensorDevices(chunk);

      tmpDevices.forEach(dev => {
        let found = sensorDevices.find(o => o.id === dev.id);
        if (found) {
          if (notchargeThreshold < dev.mA && dev.mA < sensorThreshold) {
            found.full_cnt++;
          } else {
            found.full_cnt = 0;
          }
          found.mA = dev.mA;
          found.V = dev.V;
        } else {
          sensorDevices.push({
            ...dev,
            lock: false,
            full_cnt: 0
          });
        }
      });

      handleSensorDevice(sensorDevices);
    } catch { /* wait more */ }
  });

  tcpSocket.on('close', () => {
    console.log('[TCP] Closed, reconnecting...');
    scheduleReconnect();
  });


  tcpSocket.on("error", (err) => {
    console.log("TCP error:", err.message);
    tcpSocket.destroy();
    scheduleReconnect();
  });

  tcpSocket.setKeepAlive(true, 3000);
  tcpSocket.connect(discoveredPeer.port, discoveredPeer.ip);
}
function scheduleReconnect() {
  if (tcpReconnectTimer) return;
  tcpReconnectTimer = setTimeout(() => {
    tcpReconnectTimer = null;
    tcpReconnectDelay = Math.min(tcpReconnectDelay * 2, TCP_RECONNECT_MAX_MS);
    connectTcp();
  }, tcpReconnectDelay);
}
// ========================

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

function cuLockCheckSum(arr) {
    let sum = 0;
    for (let i of arr) {
        sum += i;
    }
    return sum & 0xff;
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

function dumpArrayHex(header, arr) {
  console.log(header, arr.toString('hex').match(/.{1,2}/g).join(' '));
}

function buildCuLockGetStatusMessage(cu_id) {
  let MESS_CU = [...MESS_CU_TEMP];
  MESS_CU[2] = 0x30;
  MESS_CU[1] = (cu_id << 4) | 0;
  let mess_sum = MESS_CU.slice(0, MESS_CU.length - 1);
  MESS_CU[4] = cuLockCheckSum(mess_sum);
  return Buffer.from(MESS_CU);
}

function buildCuLockOpenMessage(deviceId, lockId) {
	let MESS_CU = [...MESS_CU_TEMP];
	MESS_CU[1]=(deviceId<<4)|(lockId - 1);
	MESS_CU[2]=0x31;
	let mess_sum=MESS_CU.slice(0,MESS_CU.length-1);
	MESS_CU[4]=cuLockCheckSum(mess_sum);
	return Buffer.from(MESS_CU);
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

function validateSensorPacket(packet) {
  if (packet.length < 6) {
    if (packet.length > 0) {
      dumpArrayHex("❌ [SENSOR] Invalid length:", packet);
    } else {
      console.log("❌ Packet length = 0");
    }
    return false;
  }

  const stx = packet[0];
  const etx = packet[packet.length - 1];

  if (stx !== 0x02 || etx !== 0x03) {
    console.log("❌ [SENSOR] Wrong STX/ETX");
    return false;
  }

  const len = packet[1];
  if (packet.length !== len + 3) {
    console.log(`❌ Wrong packet length: packet=${packet.length}, len=${len}`);
    //return false;
  }

  // CRC
  const crcLow = packet[packet.length - 2];
  const crcHigh = packet[packet.length - 3];
  const recvCrc = (crcHigh << 8) | crcLow;

  // from len to data
  const dataForCrc = packet.slice(1, packet.length - 3);
  const calcCrc = crc16(dataForCrc);

  // console.log("🔎 Debug Packet:");
  // console.log("  Raw:", [...packet].map(b => b.toString(16).padStart(2,"0")).join(" "));
  // console.log("  LEN:", len);
  // console.log("  CRC recv:", recvCrc.toString(16), " (hi:", crcHigh.toString(16), " lo:", crcLow.toString(16), ")");
  // console.log("  CRC calc:", calcCrc.toString(16));

  if (recvCrc !== calcCrc) {
    console.log("❌ CRC mismatch!");
    return false;
  }

  return true;
}


function questionAsync(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

function parseSensorDevices(byteArray) {
  if (!byteArray || byteArray.length < 1) return [];

  const buf = Buffer.from(byteArray);
  const deviceCount = buf[0];
  const devices = [];

  for (let i = 0; i < deviceCount; i++) {
    let start = 1 + i * 9;
    if (start + 9 > buf.length) {
      console.log("❌ Invalid packet length:", buf.length);
      break; // out of range
    }

    let deviceId = buf[start];
    let current = Math.round(Math.abs(buf.readFloatLE(start + 1))) >>> 0; // mA
    let voltage = Math.round(Math.abs(buf.readFloatLE(start + 5))) >>> 0; // V

    devices.push({
      id: deviceId,
      mA: current,
      V: voltage
    });
  }

  return devices;
}

function getSensorStatus(current_mA) {
  if (current_mA <= notchargeThreshold) {
    return SENSOR_STATUS_NOT_CHARGE;
  } else if (current_mA < sensorThreshold) {
    return SENSOR_STATUS_FULL_CHARGED;
  } else {
    return SENSOR_STATUS_CHARGING;
  }
}

function getSensorStatusString(status) {
  if (status === SENSOR_STATUS_NOT_CHARGE) {
    return "notcharge";
  } else if (status === SENSOR_STATUS_FULL_CHARGED) {
    return "fullcharged";
  } else {
    return "charging";
  }
}

function cuLockOpen(cu_id, lock_id) {
  let cuMsg = buildCuLockOpenMessage(cu_id, lock_id);

  cuPort.write(cuMsg, (err) => {
    if (err) {
      console.error("Send failed:", err.message);
    } else {
      dumpArrayHex('[CU][TX]', cuMsg);
    }
  });
}

function cuLockStatus(cu_id) {
  let cuMsg = buildCuLockGetStatusMessage(cu_id);

  cuPort.write(cuMsg, (err) => {
    if (err) {
      console.error("Send failed:", err.message);
    }
  });
}

async function handleSensorDevice(devices) {
  // console.log("Devices:", devices);

  for (let dev of devices) {
    let status = getSensorStatus(dev.mA);
    if (status == SENSOR_STATUS_FULL_CHARGED && dev.full_cnt >= SENSOR_FULL_CHARGED_DELAY) {
      if (dev.lock === true) {
        // cuLockOpen(CU_DEVICE_ID, dev.id);
        // await delay(250);
        // cuLockStatus(CU_DEVICE_ID);
      }
    }
  }
}


function sendAndWait(pkt, timeout = 100) {
  return new Promise((resolve) => {
    sensorResolver = (resp) => resolve(resp);
    ssPort.write(pkt, (err) => {
      if (err) {
        console.error("❌ Write error:", err.message);
        sensorResolver = null;
        resolve(null);
      }
    });
    sensorTimeoutHdl = setTimeout(() => {
      if (sensorResolver) {
        sensorResolver = null;
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

function validatePacket(packet) {
  if (packet.length < 6) {
    console.log("❌ Packet length too short");
    return false;
  }

  const stx = packet[0];
  const etx = packet[packet.length - 1];

  if (stx !== 0x02 || etx !== 0x03) {
    console.log("❌ Wrong STX/ETX");
    return false;
  }

  const len = packet[1];
  if (packet.length !== len + 3) {
    console.log(`❌ Wrong length: packet=${packet.length}, len=${len}`);
    //return false;
  }

  const crcLow = packet[packet.length - 2];
  const crcHigh = packet[packet.length - 3];
  const recvCrc = (crcHigh << 8) | crcLow;

  const dataForCrc = packet.slice(1, packet.length - 3);
  const calcCrc = crc16(dataForCrc);

  // console.log("🔎 Debug Packet:");
  // console.log("  Raw:", [...packet].map(b => b.toString(16).padStart(2,"0")).join(" "));
  // console.log("  LEN:", len);
  // console.log("  CRC recv:", recvCrc.toString(16), " (hi:", crcHigh.toString(16), " lo:", crcLow.toString(16), ")");
  // console.log("  CRC calc:", calcCrc.toString(16));

  if (recvCrc !== calcCrc) {
    console.log("❌ CRC mismatch!");
    return false;
  }

  return true;
}

async function main() {
  let store = loadStore();
  console.log("Persistance:", store);

  sensorThreshold = (store.fullcharged || 300);
  notchargeThreshold = (store.notcharged || 100);
  store.fullcharged = sensorThreshold;
  store.notcharged = notchargeThreshold;
  saveStore(store);

  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log("⚠️ No COM Port found");
    return;
  }

  console.log("COM port list:");
  ports.forEach((p, idx) => {
    console.log(`${idx + 1}) ${p.path} ${p.friendlyName || ""}`);
  });

  //------------ CU Port -------------------------
  let cuPortIdx = 0;
  do {
    const ans = await questionAsync("Select CU Lock COM port: ");
    cuPortIdx = Number(ans.trim()) - 1;
    if (cuPortIdx < 0 || cuPortIdx >= ports.length) {
      console.log("❌ Invalid selection");
    }
  } while (cuPortIdx < 0 || cuPortIdx >= ports.length);

  const cuPath = ports[cuPortIdx].path;
  const cuBaud = 19200;
  cuPort = new SerialPort({ path: cuPath, baudRate: cuBaud, autoOpen: false });

  /* Init CU Lock COM port */
  let rxBuffer = Buffer.alloc(0);

  cuPort.on("data", (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    while (rxBuffer.length >= 9) {
      const frame = rxBuffer.slice(0, 9);

      if (frame[0] === 0x02 && frame[1] === CU_DEVICE_ID && frame[2] === 0x35) {
        let status = (frame[4] << 8) | frame[3];

        for (let dev_id = 0; dev_id < 16; dev_id++) {
          let lock_stt = ((status >> dev_id) & 1) === 1;
          let found = sensorDevices.find(o => o.id === dev_id + 1);
          if (found) {
            if (found.lock !== lock_stt) {
              console.log(`[CU][${dev_id}]`, lock_stt ? "true" : "false");
              found.lock = lock_stt;
            }

            if (lock_stt && found.mA <= notchargeThreshold) {
              cuLockOpen(CU_DEVICE_ID, dev_id + 1);
            }
          }
        }

        rxBuffer = rxBuffer.slice(9);
      } else {
        dumpArrayHex("❌ [CU][RX]:", rxBuffer);
        rxBuffer = rxBuffer.slice(1);
      }
    }
  });

  cuPort.on("open", () => console.log(`✅ [CU] Opened ${cuPath} @${cuBaud}`));
  cuPort.on("error", (err) => console.error("⚠️ [CU] Error:", err.message));

  let ssPortIdx = 0;
  do {
    const ans = await questionAsync("Select Sensor COM port: ");
    ssPortIdx = Number(ans.trim()) - 1;
    if (ssPortIdx < 0 || ssPortIdx >= ports.length) {
      console.log("❌ Invalid selection");
    } 
    else if (ssPortIdx == cuPortIdx) {
      console.log(ports[cuPortIdx].path, "has been selected by CU Lock");
    }
  } while (ssPortIdx < 0 || ssPortIdx >= ports.length );//|| ssPortIdx == cuPortIdx);

  const ssPath = ports[ssPortIdx].path;
  const ssBaud = 115200;
  ssPort = new SerialPort({ path: ssPath, baudRate: ssBaud, autoOpen: false });

  /* Init Sensor COM port */
  let recvBuffer = Buffer.alloc(0);

  ssPort.on("data", (chunk) => {
    // dumpArrayHex("[RX] [SENSOR]", chunk)

    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 7) {
      const stx = recvBuffer.indexOf(0x02);
      const etx = recvBuffer.indexOf(0x03, stx + 1);
      if (stx === -1 || etx === -1) break;

      const packet = recvBuffer.slice(stx, etx + 1);
      recvBuffer = recvBuffer.slice(etx + 1);

      if (validatePacket(packet)) {
        if (sensorResolver) {
            clearTimeout(sensorTimeoutHdl);
            sensorResolver(packet);
            sensorResolver = null;
          } else {
          console.log("No Resolver");
        }
      } else {
        console.log("CRC failed");
      }
    }
  });

  ssPort.on("open", () => console.log(`✅ [SENSOR] Opened ${ssPath} @${ssBaud}`));
  ssPort.on("error", (err) => console.error("⚠️ [SENSOR] Error:", err.message));

  await new Promise((res, rej) => cuPort.open((err) => (err ? rej(err) : res())));
  await new Promise((res, rej) => ssPort.open((err) => (err ? rej(err) : res())));

  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/getStatus") {
      let results = [];

      // console.log("Retrieving device status...");
      for (let id of WIRED_DEVICE_ID) {
        const pkt = buildPacket(id, CMD_GET_CURRENT_mA);
        const resp = await sendAndWait(pkt, 100);
        if (resp) {
		      const mADataBytes = resp.slice(3, 7);
		      const mA = Math.round(Math.abs(mADataBytes.readFloatLE(0)));
          const vDataBytes = resp.slice(7, 11);
          const V = Math.round(Math.abs(vDataBytes.readFloatLE(0)));
          const smoke = resp.length > 11 ? resp[11] !== 0 : false;
          const fire  = resp.length > 12 ? resp[12] !== 0 : false;
          let statusStr = getSensorStatusString(getSensorStatus(mA));

          let found = sensorDevices.find(o => o.id === id);
          let lock = false;
          if (found) {
            if (notchargeThreshold < mA && mA < sensorThreshold) {
              found.full_cnt++;
            } else {
              found.full_cnt = 0;
            }
            found.mA = mA;
            found.V = V;
            found.smoke = smoke;
            found.fire  = fire;

            lock = found.lock;
          } else {
            sensorDevices.push({
              id: id,
              mA: mA,
              V: V,
              lock: false,
              full_cnt: 0,
              smoke: smoke,
              fire: fire
            });
          }

          // console.log('[' + id + '] ' + mA + ' mA - ' + V + ' V');
        } else {
          // console.log('[' + id + ']' + " Timeout");
        }
      }

      for (let dev of sensorDevices) {   
        let statusStr = getSensorStatusString(getSensorStatus(dev.mA));
        results.push({ id: dev.id, mA: dev.mA, V: dev.V, status: statusStr, lock: dev.lock, smoke: dev.smoke || false, fire: dev.fire || false });
      }

      const json = JSON.stringify({ results }, null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(json);
    }
    else if (req.method === "POST" && req.url === "/setThreshold") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const fullcharged = data.fullcharged;
          const notcharged = data.notcharged;
          if (typeof fullcharged !== "number" || typeof notcharged !== "number") {
            res.writeHead(400);
            res.end("Invalid threshold");
          } else {
            sensorThreshold = fullcharged;
            store.fullcharged = sensorThreshold;
            notchargeThreshold = notcharged;
            store.notcharged = notchargeThreshold;
            saveStore(store);
            let msg = "✅ Full Charged: " + sensorThreshold + "(mA), Not Charged:" + notchargeThreshold + "(mA)";
            console.log(msg);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: msg }, null, 2));
          }
		    } catch (e) {
          res.writeHead(400);
          res.end("Invalid JSON");
        }
      });
    }
    else if (req.method === "POST" && req.url === "/unlock") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const locker_id = data.id;
          console.log("Request /unlock", data);
          if (typeof locker_id !== "number") {
            res.writeHead(400);
            res.end("Invalid Device ID");
          } else {
            let found = sensorDevices.find(o => o.id === locker_id);
            if (found) {
              console.log("Found", found);
              if (found.lock) {
                let status = getSensorStatus(found.mA);
                if ((status === SENSOR_STATUS_FULL_CHARGED && found.full_cnt >= SENSOR_FULL_CHARGED_DELAY)
                      || status == SENSOR_STATUS_NOT_CHARGE) {
                  cuLockOpen(CU_DEVICE_ID, found.id);
                  await delay(250);
                  cuLockStatus(CU_DEVICE_ID);
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ message: 'Success' }, null, 2));
                } else {
                  res.writeHead(400, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ message: 'Device is charging!' }, null, 2));
                }
              } else {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: 'Already unlocked!' }, null, 2));
              }
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ message: 'Device not found' }, null, 2));
            }
          }
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

  setInterval(() => {
    cuLockStatus(CU_DEVICE_ID);

  }, 2000);

  const PORT_HTTP = 3000;
  server.listen(PORT_HTTP, () => {
    console.log(`🌐 HTTP server listening on http://localhost:${PORT_HTTP}`);
  });

  startUdp();
}

main();
