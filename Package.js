const mongoose = require('mongoose');


const packageSchama = new mongoose.Schema ({
    packageName: {type: String},
    price: {type: Number},
    description: {type: String},
    professors: {type: Array, default: []},
});

module.exports = mongoose.model('Package', packageSchama);