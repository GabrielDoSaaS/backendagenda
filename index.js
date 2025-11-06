require('dotenv').config( );
const nodemailer = require('nodemailer');
const Payment = require('./Payment');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./User');
const Product = require('./Product');
const connectToDB = require('./ConnectToDB');
const PaymentsController = require('./PaymentsController');
const Package = require('./Package');

connectToDB( );

const app = express( );
app.use(cors());
app.use(express.json({limit: '10mb'}));


app.get('/getPayments', async (req, res) => {
    try {
        const payments = await Payment.find( );
        

        res.json({payments: payments});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro buscar pagamentos' });
    }
})

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.find
            ({ email, password });

            console.log(user);
        if (user.length === 0) {
            return res.status(400).json({ error: 'Usuário ou senha incorretos' });
        }
        res.json({ user: user[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

app.post('/payPerClass', PaymentsController.PayPerClass);
app.post('/find-payment-class', PaymentsController.findPaymentsClass);
app.post('/buyProduct', PaymentsController.BuyProduct);
app.post('/webhook', PaymentsController.Webhook);

app.post('/addProduct', async (req, res) => {
  try {
    const {  nameProduct, description, value, images, frete, CEP, wheight, height, width } = req.body;

    if (!images || !nameProduct || !value) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    const product = await Product.create({ nameProduct, description, price: value,  images, frete, CEP, wheight, height, width });

    console.log('Produto criado com sucesso:', product);

    res.status(201).json({ message: 'Produto criado com sucesso', product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar o produto' });
  }
});

app.get('/getProducts', async (req, res) => {
    try {
        const products = await Product.find( );
        
        res.json({products: products});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro buscar produtos' });
    }
})

app.delete('/deleteProduct/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await Product.findByIdAndDelete(id);
        res.json({message: 'Produto deletado com sucesso'});
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar produto' });
    }
})

app.post('/editProduct/:id', async (req, res) => {
    const { id } = req.params;
    const { nameProduct, description, value, images } = req.body;
    try {
        const product = await Product
            .findByIdAndUpdate(id, { nameProduct, description, price: value, images }, { new: true });
        res.json({ message: 'Produto atualizado com sucesso', product });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
})

app.post('/addProfessor', async (req, res) => {
    const { name, description, email, password, specialties, picture, pix } = req.body;

    try {
        const userExists = await User.findOne({email});
        if (userExists) {
            return res.status(400).json({ error: 'Usuário já existe com esse email' });
        }

        const user = await User.create({ name, description, email, password, specialties, picture, pix });
        
        res.status(201).json({ message: 'Professor criado com sucesso', user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar o professor' });
    }

})

app.get('/getProfessor', async (req, res) => {
    try {
        const professors = await User.find( );
        res.json({professors: professors});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro buscar professores' });
    }
});

app.delete('/deleteProfessor/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await User.findByIdAndDelete(id);
        res.json({message: 'Professor deletado com sucesso'});
    } 
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar professor' });
    }
});

app.post('/editProfessor/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, email, password, specialties, picture } = req.body;

    try {
        const user = await User
            .findByIdAndUpdate(id, { name, description, email, password, specialties, picture },
                { new: true });
        res.json({ message: 'Professor atualizado com sucesso', user });
    }  
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar professor' });
    }
});

app.post('/addAgenda', async (req, res) => {
    const { name, professor, date, hour } = req.body;

    try {
        const professorFound = await User.findOne({name: professor});
        await professorFound.scheduledClients.push({name, date, hour});
        await professorFound.save();


         let transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
                user: 'sendermailservice01@gmail.com',
                pass: "slht vdcm pfgi mmru"
            }
        });
            
        let mailOptions = {
                from: 'senderemailservice01@gmail.com',
                to: professorFound.email,
                subject: "Agendamento concluido",
                text: `Prezado(a) Professor(a) ${professor},

                Um novo aluno realizou o pagamento e confirmou um agendamento de aula com você. Por favor, acesse seu Painel do Professor para verificar os detalhes completos da reserva., 
                `
        };


    transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.log('Erro:', error);
            } else {
                    console.log('Email enviado:', info.response);
            }
    });

    res.status(200).json({ 
        message: 'Agendamento realizado com sucesso',
        success: true 
    });


    } catch (err) {
        console.log('err')
        res.status(500);
    }
})

app.post('/findAgenda', async (req, res) => {
    const { professor } = req.body;
    const agendaFound = await User.findOne({name: professor});


    res.send(agendaFound.scheduledClients);
})

app.post('/findConfigSchedule', async (req, res) => {
    const { professor } = req.body;
    const configFound = await User.findOne({name: professor});
    res.send(configFound.configSchedule);
})

app.post('/webhook', PaymentsController.Webhook);

app.post('/AddScheduledClient', async (req, res) => {
    const { professor, client } = req.body;
    try {

        console.log('Professor recebido:', professor, "cliente:", client);
        const professorFound = await User.findOne({name: professor});
        await professorFound.scheduledClients.push(client);
        await professorFound.save();

        console.log('Professor atualizado:', professorFound);

        res.json({message: 'Cliente agendado com sucesso'});
    } catch (err) {
        console.log('err')
        res.status(500);
    }
})

// Backend Node.js/Express (Exemplo usando Mongoose)

app.post('/AddConfigSchedule', async (req, res) => {
    const { professor, config } = req.body;
    try {
        // 1. Log inicial para confirmar o recebimento
        console.log('Professor recebido:', professor, "config:", config);

        // 2. Busca o professor no banco de dados
        const professorFound = await User.findOne({ name: professor });

        // VERIFICAÇÃO CRÍTICA: Se o professor não for encontrado
        if (!professorFound) {
            console.log(`Erro: Professor '${professor}' não encontrado.`);
            // Envia status 404 (Não Encontrado) e encerra
            return res.status(404).json({ error: 'Professor não encontrado.' });
        }

        // 3. Atualiza a configuração de agenda
        professorFound.configSchedule = config;
        
        // 4. Salva no banco de dados
        await professorFound.save();
        
        // 5. Resposta de sucesso (Status 200 - OK)
        console.log('Professor atualizado com sucesso:', professorFound.name);
        return res.status(200).json({
            message: 'Configuração de agenda salva com sucesso',
            // O frontend usa este objeto para atualizar o estado principal
            professor: professorFound 
        });

    } catch (err) {
        console.error('Erro interno ao salvar a configuração de agenda:', err);
        return res.status(500).json({
            error: 'Erro interno do servidor ao salvar a agenda.',
            details: err.message 
        });
    }
});


app.post('/addPackage', async( req, res ) => {
    const {packageName, price, description, professors } = req.body;

    await Package.create({packageName, price, description, professors});
    console.log(professors);
    res.send('ok');
})


app.get('/getPackages', async (req, res) => {
    const packages = await Package.find();


    res.json(packages);
})

app.post('/payperclass-pix', PaymentsController.createQrcodePix);
app.post('/payperclass-creditcard', PaymentsController.createCreditCardPayment);

app.post('/buyProductWithPix', PaymentsController.BuyProductTransparentPix);
app.post('/buyProductWithCreditCard', PaymentsController.BuyProductTransparentCreditCard);
app.post('/getbuyersProducts', async (req, res ) => {
    const {nameBuyer} = req.body;


    const payment = await Payment.findOne({nameBuyer: nameBuyer});


    res.send(payment.isPaid);
})
app.listen(3000, ( ) => {
    console.log('project is running')
})