const mongoose = require('mongoose');


const PaymentSchema = new mongoose.Schema ({
    nameBuyer: {type: String, required: true},
    productName: {type: String, required: false},
    address: {type: String, required: false},
    frete: {type: Number},
    isPaid: {type: Boolean, required: true},
});

module.exports = mongoose.model('Payment', PaymentSchema);