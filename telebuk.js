"use strict";
import { config } from "dotenv";
config();
import { createClient } from "redis";
import { MongoClient, MongoServerError, ObjectID } from "mongodb";
import _ from "lodash";
import fetch from 'node-fetch';

import readXlsxFile from 'read-excel-file/node'

// Connection Mongodb

const clientMongo = new MongoClient("mongodb://192.168.1.29:27017");
const dbName = "teleship";
const db = clientMongo.db(dbName);
const Post = db.collection("post");
const Trip = db.collection("trip");
const Shipper = db.collection("shipper");
await clientMongo.connect();
console.log("Connected successfully to MongoDB server");
// let shipper_info = await Shipper.findOne({phone: "+84905997022"})
// console.log(shipper_info)
const clientRedis = createClient({
	url: "redis://192.168.1.17",
	// url: "redis://localhost",
});
clientRedis.on("error", (err) => console.log("Redis Client Error", err));

await clientRedis.connect();
const subscriber = clientRedis.duplicate();

await subscriber.connect();
await subscriber.subscribe("NEW_POST_IMPORT", async (filePath) => {
	console.log(filePath); // 'message'
	importPost(filePath);
});

const ExcelSchema = {
	'telebuk': {
		'services_id': {
			// JSON object property name.
			prop: 'services_id',
			type: String,
			required: true
		},
		'partner_bill': {
			prop: 'partner_bill',
			type: String
		},
		'pickup_name': {
			prop: 'pickup_name',
			type: String
		},
		'pickup_phone': {
			prop: 'pickup_phone',
			type: String
		},
		'pickup_add': {
			prop: 'pickup_add',
			type: String
		},
		'delivery_name': {
			prop: 'delivery_name',
			type: String
		},
		'delivery_phone': {
			prop: 'delivery_phone',
			type: String
		},
		'delivery_add': {
			prop: 'delivery_add',
			type: String
		},
		'cod': {
			prop: 'cod',
			type: Number
		},
		'weight (gram)': {
			prop: 'weight',
			type: Number
		},
		'commodity_name': {
			prop: 'commodity_name',
			type: String
		},
		'note_ship': {
			prop: 'note_ship',
			type: String
		},
		'shipper_phone': {
			prop: 'shipper_phone',
			type: String
		}
	}
}

async function importPost(file) {

	// File path.
	readXlsxFile(file, { schema: ExcelSchema.telebuk }).then(async (data) => {
		// `rows` is an array of rows
		// each row being an array of cells.
		if (data && data.rows && data.rows.length) {
			let rs = _.groupBy(data.rows, function (item) {
				return item.shipper_phone
			})
			let trips = [];
			let shipper_phones = _.keys(rs);
			let shop_phone = data.rows[0].pickup_phone
			console.log('x' + shop_phone +'x')
			const shop_info = await Shipper.findOne({ phone: "+84768401040" })
			console.log('shop_phone')
			console.log(shop_info)
			await Promise.all(
				shipper_phones.map(async (phone) => {
					const shipper_info = await Shipper.findOne({ phone: phone })
					let orders = [];
					let total_cod = 0;
					_.forEach(rs[phone], function (order) {
						total_cod += order.cod || 0;
						orders.push({
							partner_bill: order.partner_bill,
							delivery_name: order.delivery_name,
							delivery_phone: order.delivery_phone,
							delivery_add: order.delivery_add,
							cod: order.cod,
							weight: order.weight,
							commodity_name: order.commodity_name,
							note_ship: order.note_ship
						})
					})
					trips.push({
						_id : new ObjectID(),
						shop_tele_id: shop_info.id,
						shipper_phone: phone,
						shipper_tele_id: shipper_info.id,
						shipper_tele_bot_token: shipper_info.tele_bot_token,
						services_id: rs[phone][0].services_id,
						pickup_name: rs[phone][0].pickup_name,
						pickup_phone: rs[phone][0].pickup_phone,
						pickup_add: rs[phone][0].pickup_add,
						total_cod: total_cod,
						orders
					})
				})
			);
			const insertResult = await Trip.insertMany(trips);
			const insertedIds = _.get(insertResult, 'insertedIds', {});
			if (insertedIds && _.keys(insertedIds).length) {
				const responseReport = await fetch(`https://report-dashboard-apis.qupworld.com/api/save_trip`, {
						method: 'post',
						body: JSON.stringify(trips),
						headers: { 'Content-Type': 'application/json' }
					});
				const dataReport = await responseReport.json();
				console.log(dataReport)
				trips.map(async function (trip) {
					console.log(trip.shipper_tele_id, "https://wblite.qupworld.com/?id=" + trip._id);
					let captionShop = 'Đã tạo thành công, đơn hàng đang được bắn đến shipper';
					captionShop += 'Tổng đơn: ' + trip.orders.length;
					captionShop += '\nTổng COD: ' + trip.total_cod
					captionShop += '\nKhoảng cách:'
					//.COOKIE
					const responseShop = await fetch(`https://api.telegram.org/bot${process.env.TELEBUK_BOT_TOKEN}/sendPhoto`, {
						method: 'post',
						body: JSON.stringify({
							"parse_mode": "html",
							"chat_id": trip.shop_tele_id,
							"caption": captionShop,
							"photo": "https://i.imgur.com/0MgyMBb.png",
							"disable_web_page_preview": true,
							"protect_content": true,
							"reply_markup": {
								"inline_keyboard": [
									[
										{
											"text": "Chi tiết đơn hàng",
											"web_app": {
												"url": "https://report-dashboard-apis.qupworld.com/api/get_trip/" + trip._id
											}
										}
									]
								]
							}
						}),
						headers: { 'Content-Type': 'application/json' }
					});
					const dataShop = await responseShop.json();
					console.log(dataShop)
					let caption = ''
					caption += 'Tổng đơn: ' + trip.orders.length;
					caption += '\nTổng COD: ' + trip.total_cod
					caption += '\nKhoảng cách:'
					//https://i.imgur.com/0MgyMBb.png
					const response = await fetch(`https://api.telegram.org/bot${trip.shipper_tele_bot_token}/sendPhoto`, {
						method: 'post',
						body: JSON.stringify({
							"parse_mode": "html",
							"chat_id": trip.shipper_tele_id,
							"caption": caption,
							"photo": "https://i.imgur.com/0MgyMBb.png",
							"disable_web_page_preview": true,
							"protect_content": true,
							"reply_markup": {
								"inline_keyboard": [
									[
										{
											"text": "Chi tiết đơn hàng",
											"web_app": {
												"url": "https://report-dashboard-apis.qupworld.com/api/get_trip/" + trip._id
											}
										}
									]
								]
							}
						}),
						headers: { 'Content-Type': 'application/json' }
					});
					const data = await response.json();
					console.log(data)
				})
			}

		} else {
			console.log('invalid file');
		}
	})
}
