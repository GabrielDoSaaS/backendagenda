const mongoose = require('mongoose');

const connectToDB = async () => {
    try {
        await mongoose.connect('mongodb+srv://gabriel:1981Abcd.@cluster0.cohpkyz.mongodb.net/', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Conectado ao banco de dados MongoDB');
    } catch (error) {
        console.error('Erro ao conectar ao banco de dados MongoDB:', error);
    }
};

module.exports = connectToDB;