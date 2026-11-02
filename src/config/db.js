const mongoose = require("mongoose")



function connectToDB() {

    // maxPoolSize: Mongoose defaults to 5 connections, which serializes
    // concurrent requests through 5 sockets. 50 is safe on the free Atlas
    // tier and lets real concurrency through.
    mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 50 })
        .then(() => {
            console.log("server is connected to DB")
        })
        .catch(err => {
            console.log("Error connecting to DB")
            process.exit(1)
        })

}


module.exports = connectToDB