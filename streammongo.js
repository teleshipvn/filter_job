"use strict";
import { MongoClient, MongoServerError, ObjectId, ObjectID } from "mongodb";
import _ from "lodash";
import fs from "fs";


// Connection Mongodb

const clientMongo = new MongoClient("mongodb://192.168.1.47:27017");
const dbName = "teleship";
const db = clientMongo.db(dbName);
const Post = db.collection("post");

var stream = Post.find({time_posted: {$gt: 1701441164}}).stream()
stream.on('error', function (err) {
  console.error(err)
})
stream.on('data', function (doc) {
  stream.pause();
  if (doc.price && doc.price < 100 && doc.start_location_lat && doc.start_location_lng) {
    fs.appendFile("./post.csv", `${doc.group_id},${doc.user_fbid},${doc.name},${doc.time_posted},${doc.price},${doc.start_location_lat},${doc.start_location_lng}\n`, function(){
      stream.resume();
    });
  } else {
    stream.resume();
  }
  
})
stream.on("end", function () {
  // all done
  console.log("DONE");
  // console.log(count, total_price)
  // fs.writeFileSync('./list_user_fbid.json', JSON.stringify(list_user_fbid))
});

