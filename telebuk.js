"use strict";
import { config } from "dotenv";
config();
import { createClient } from "redis";
import { MongoClient, MongoServerError, ObjectId, ObjectID } from "mongodb";
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
await subscriber.subscribe(["NEW_POST_IMPORT", 'NEW_POST_CONFIRM'], async (data, channel) => {
	// console.log(filePath); // 'message'
	// importPost(filePath);
	console.log(data, channel);
	if (channel === 'NEW_POST_CONFIRM') {
		confirmPost(data);
	}
	if (channel === 'NEW_POST_IMPORT') {
		importPost(data);
	}
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
			type: String,
			required: true
		},
		'pickup_phone': {
			prop: 'pickup_phone',
			type: String,
			required: true
		},
		'pickup_add': {
			prop: 'pickup_add',
			type: String,
			required: true
		},
		'delivery_name': {
			prop: 'delivery_name',
			type: String,
			required: true
		},
		'delivery_phone': {
			prop: 'delivery_phone',
			type: String,
			required: true
		},
		'delivery_add': {
			prop: 'delivery_add',
			type: String,
			required: true
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
async function confirmPost(requestId) {
	const trips = await Trip.find({requestId}).toArray()
	if (trips && trips.length) {
		const responseReport = await fetch(`https://report-dashboard-apis.qupworld.com/api/save_trip`, {
				method: 'post',
				body: JSON.stringify(trips),
				headers: { 'Content-Type': 'application/json' }
			});
		const dataReport = await responseReport.json();
		console.log(dataReport)

		trips.map(async function (trip) {
			let caption = ''
			caption += 'Tổng đơn: ' + trip.orders.length;
			caption += '\nTổng COD: ' + trip.total_cod
			caption += '\nKhoảng cách:'
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
	} else {
		console.log('not found trip')
	}
}
async function importPost(file) {

	// File path.
	readXlsxFile(file, { schema: ExcelSchema.telebuk }).then(async (data) => {
		// `rows` is an array of rows
		// each row being an array of cells.
		if (data && data.rows && data.rows.length) {
			let total_trip = 0;
			let total_order = 0;
			let total_cod = 0;
			let rs = _.groupBy(data.rows, function (item) {
				return item.shipper_phone
			})
			let trips = [];
			let requestId = new ObjectId();
			let shipper_phones = _.keys(rs);
			let shop_phone = data.rows[0].pickup_phone
			const shop_info = await Shipper.findOne({ phone: shop_phone })
			await Promise.all(
				shipper_phones.map(async (phone) => {
					const shipper_info = await Shipper.findOne({ phone: phone })
					let orders = [];
					let total_cod_trip = 0;
					_.forEach(rs[phone], function (order) {
						total_cod_trip += order.cod || 0;
						total_cod += order.cod || 0;
						total_order += 1;
						orders.push({
							partner_bill: order.partner_bill,
							delivery_name: order.delivery_name,
							delivery_phone: order.delivery_phone,
							delivery_add: order.delivery_add,
							cod: order.cod,
							weight: order.weight,
							commodity_name: order.commodity_name,
							note_ship: order.note_ship,
							status: 'Đang giao'
						})
					})
					total_trip += 1;
					trips.push({
						requestId,
						_id : new ObjectId(),
						shop_tele_id: shop_info.id,
						shipper_phone: phone,
						shipper_tele_id: shipper_info.id,
						shipper_tele_bot_token: shipper_info.tele_bot_token,
						services_id: rs[phone][0].services_id,
						pickup_name: rs[phone][0].pickup_name,
						pickup_phone: rs[phone][0].pickup_phone,
						pickup_add: rs[phone][0].pickup_add,
						total_cod: total_cod_trip,
						orders,
						status: "pending"
					})
				})
			);
			const insertResult = await Trip.insertMany(trips);
			const insertedIds = _.get(insertResult, 'insertedIds', {});
			if (insertedIds && _.keys(insertedIds).length) {
				
				let captionShop = 'Vui lòng kiểm tra và xác nhận\n';
				captionShop += 'Số chuyến: ' + total_trip;
				captionShop += 'Số đơn: ' + total_order;
				captionShop += '\nTổng COD: ' + total_cod
				captionShop += '\nKhoảng cách:'
				const responseShop = await fetch(`https://api.telegram.org/bot${process.env.TELEBUK_BOT_TOKEN}/sendPhoto`, {
					method: 'post',
					body: JSON.stringify({
						"parse_mode": "html",
						"chat_id": shop_info.id,
						"caption": captionShop,
						"photo": "https://i.imgur.com/0MgyMBb.png",
						"disable_web_page_preview": true,
						"protect_content": true,
						"reply_markup": {
							"inline_keyboard": [
								// [
								// 	{
								// 		"text": "Chi tiết đơn hàng",
								// 		"web_app": {
								// 			"url": "https://report-dashboard-apis.qupworld.com/api/get_trip/" + requestId
								// 		}
								// 	}
								// ],
								[
									{
										"text": "XÁC NHẬN",
										"callback_data": "accept-" + requestId
									},
									{
										"text": "HUỶ",
										"callback_data": "reject-" + requestId
									}
								]
							]
						}
					}),
					headers: { 'Content-Type': 'application/json' }
				});
				const dataShop = await responseShop.json();
				console.log(dataShop)
				
			}

		} else {
			console.log('File không đúng định dạng, vui lòng xem lại');

		}
	})
}
