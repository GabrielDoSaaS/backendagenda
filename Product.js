const mongoose = require('mongoose');


const ProductSchema = new mongoose.Schema ({
    nameProduct: {type: String, required: true},
    description: {type: String, required: true},
    price: {type: String, required: true},
    images: {type: Array, default: []},
    frete: {type:Boolean},
    CEP: {type: String},
    wheight: {type: Number},
    height: {type: Number},
    width: {type: Number},

});

module.exports = mongoose.model('Product', ProductSchema);