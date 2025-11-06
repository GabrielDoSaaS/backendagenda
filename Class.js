const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
    nameUser: {type: String},
    id: {type: String},
    isPay: {type: Boolean, default: false}
})

module.exports = mongoose.model('Class', ClassSchema);