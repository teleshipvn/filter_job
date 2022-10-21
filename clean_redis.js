"use strict";
import { config } from "dotenv";
config();
import { createClient } from "redis";
import _ from "lodash";
const clientRedis = createClient({
  url: "redis://localhost"
});
clientRedis.on("error", (err) => console.log("Redis Client Error", err));

await clientRedis.connect();

let keys = await clientRedis.KEYS('IP_BLOCKED:*')
console.log(keys);
