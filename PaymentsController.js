const axios = require('axios');
const Payment = require('./Payment');
const User = require('./User'); // Modelo de professor
const Class = require('./Class');
const calcularFrete = require('./calcularFrete');

// =================================================================
// CONFIGURAÇÃO ASAAS
// =================================================================
const asaas = axios.create({
  baseURL: "https://api.asaas.com/api/v3",
  headers: {
    'Content-Type': 'application/json',
    'access_token': process.env.ASAAS_API_KEY,
  },
});

// =================================================================
// FUNÇÃO DE REPASSE PIX
// =================================================================
const repassarPix = async (pixKey, valor, descricao = 'Repasse de aula') => {
  try {
    const resp = await asaas.post('/pix/transactions', {
      value: valor,
      pixAddressKey: pixKey,
      description: descricao,
    });

    console.log('✅ Pix de repasse enviado:', resp.data);
    return resp.data;
  } catch (err) {
    console.error('❌ Erro ao enviar Pix de repasse:', err.response?.data || err.message);
    throw err;
  }
};

// =================================================================
// FUNÇÃO DE WEBHOOK
// =================================================================
const Webhook = async (req, res) => {
  try {
    const event = req.body;
    console.log('🔔 Webhook recebido do Asaas:', JSON.stringify(event, null, 2));

    if (!event || !event.event) {
      return res.status(400).json({ error: 'Payload inválido' });
    }

    const payment = event.payment || {};
    const eventType = event.event;

    switch (eventType) {
      case 'PAYMENT_CONFIRMED':
        console.log(`🟢 Pagamento confirmado! ID: ${payment.id}`);

        let externalRef = payment.externalReference;

        // Tenta interpretar como ID do Payment
        if (externalRef) {
          try {
            const paymentRecord = await Payment.findById(externalRef);
            if (paymentRecord) {
              paymentRecord.isPaid = true;
              await paymentRecord.save();
              console.log(`💾 Pagamento ${externalRef} marcado como pago (isPaid = true).`);
            } else {
              console.warn(`⚠️ Payment ID ${externalRef} não encontrado no banco.`);
            }
          } catch (err) {
            console.error('❌ Erro ao atualizar Payment:', err.message);
          }
        }

        // Repasse automático para aulas
        try {
          const externalRefData = payment.externalReferenceData || {};
          if (externalRefData.teacherId) {
            const teacher = await User.findById(externalRefData.teacherId);
            const pay = await Class.findOne({id: payment.customer});

            pay.isPay = true;
            await pay.save();


            if (teacher && teacher.pix) {
              const valorBruto = payment.value;
              let taxa = 0;

              switch (payment.billingType) {
                case 'PIX':
                  taxa = valorBruto * 0.0145;
                  break;
                case 'CREDIT_CARD':
                  taxa = valorBruto * 0.0499 + 0.5;
                  break;
                case 'BOLETO':
                  taxa = 2.5;
                  break;
                default:
                  taxa = 0;
              }

              const valorLiquido = valorBruto - taxa;

              await repassarPix(teacher.pix, valorLiquido, `Repasse da aula - ${teacher.name || teacher.id}`);
              console.log(`💸 Repasse Pix enviado para ${teacher.name || teacher.id} - Valor líquido: R$${valorLiquido.toFixed(2)}`);
            }
          }
        } catch (repasseErr) {
          console.error('❌ Erro ao repassar Pix:', repasseErr.message);
        }

        return res.status(200).json({ ok: true });

      case 'PAYMENT_CREATED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_DELETED':
        console.log(`ℹ️ Evento: ${eventType} ID: ${payment.id}`);
        return res.status(200).json({ ok: true });

      default:
        console.log(`ℹ️ Evento não tratado: ${eventType}`);
        return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error('❌ Erro ao processar webhook:', err);
    return res.status(500).json({ error: 'Erro interno ao processar webhook' });
  }
};

// =================================================================
// FUNÇÃO DE COMPRA DE PRODUTO
// =================================================================
const BuyProduct = async (req, res) => {
  try {
    const { product, buyerData } = req.body;

    if (!product || !buyerData) {
      return res.status(400).json({ error: 'product e buyerData são obrigatórios' });
    }

    // --- 1) Verifica ou cria cliente ---
    let customerId = null;
    try {
      if (buyerData.cpf) {
        const listResp = await asaas.get('/customers', {
          params: { cpfCnpj: buyerData.cpf.replace(/\D/g, '') },
        });
        const items = listResp.data.data || listResp.data;
        if (Array.isArray(items) && items.length > 0) {
          customerId = items[0].id;
        }
      }
    } catch (err) {
      console.warn('Erro ao buscar cliente (ok, tentaremos criar):', err?.response?.data || err.message);
    }

    if (!customerId) {
      const newCustomerPayload = {
        name: buyerData.name,
        email: buyerData.email,
        cpfCnpj: buyerData.cpf ? buyerData.cpf.replace(/\D/g, '') : undefined,
        mobilePhone: buyerData.phone ? buyerData.phone.replace(/\D/g, '') : undefined,
        address: buyerData.address || undefined,
      };
      Object.keys(newCustomerPayload).forEach(
        (k) => newCustomerPayload[k] === undefined && delete newCustomerPayload[k]
      );

      const createCustomerResp = await asaas.post('/customers', newCustomerPayload);
      customerId = createCustomerResp.data?.id;
    }

    if (!customerId) {
      return res.status(500).json({
        ok: false,
        error: { message: 'Não foi possível obter/gerar o customerId no Asaas' },
      });
    }

    // --- 2) Cria pagamento no banco ---
    const paymentRecord = await Payment.create({
      nameBuyer: buyerData.name,
      productName: product.nameProduct,
      address: buyerData.address,
      isPaid: false,
    });

    // --- 3) Define successUrl ---
    const successUrl = 'https://www.youtube.com/watch?v=gD7L1UxLy7k';

    // --- 4) Monta payload do Payment Link ---
    const paymentLinkPayload = {
      name: product.nameProduct || 'Produto',
      description: `Compra de ${product.nameProduct || 'produto'}`,
      chargeType: 'DETACHED',
      billingType: 'UNDEFINED',
      value: Number(product.price),
      customer: customerId,
      dueDateLimitDays: 1,
      externalReference: paymentRecord.id.toString(), // somente o ID
      callback: {
        successUrl,
        autoRedirect: true,
      },
    };

    // --- 5) Cria link de pagamento ---
    const linkResp = await asaas.post('/paymentLinks', paymentLinkPayload);
    const asaasData = linkResp.data;

    if (!asaasData.url) {
      return res.status(500).json({
        ok: false,
        error: { message: 'A API do Asaas não retornou o link de pagamento.' },
      });
    }

    console.log('✅ Link de pagamento criado:', asaasData.url);

    return res.json({
      ok: true,
      redirectUrl: asaasData.url,
      message: 'Link de pagamento gerado com sucesso.',
    });
  } catch (err) {
    console.error('Erro /checkout:', err?.response?.data || err.message || err);
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err.message || 'Erro interno' };

    if (data.errors) {
      return res.status(status).json({
        ok: false,
        error: data.errors,
        message: 'Falha na validação dos dados do cliente pela Asaas.',
      });
    }

    return res.status(status).json({ ok: false, error: data });
  }
};

// =================================================================
// FUNÇÃO DE PAGAMENTO POR AULA
// =================================================================
const PayPerClass = async (req, res) => {
  const { id, price } = req.body;

  if (!id || !price) {
    return res.status(400).json({ error: 'professor e value são obrigatórios' });
  }

  const successUrl = 'https://www.youtube.com/watch?v=gD7L1UxLy7k';

  const payload = {
    name: 'agendamento',
    description: 'Agendamento de aula',
    value: price,
    chargeType: 'DETACHED',
    billingType: 'UNDEFINED',
    dueDateLimitDays: 1,
    externalReference: JSON.stringify({ teacherId: id, isProduct: false }),
    callback: {
      successUrl,
      autoRedirect: true,
    },
  };

  const linkResp = await asaas.post('/paymentLinks', payload);
  const asaasData = linkResp.data;

  if (!asaasData.url) {
    return res.status(500).json({
      ok: false,
      error: { message: 'A API do Asaas não retornou o link de pagamento.' },
    });
  }

  console.log('✅ Link de pagamento criado:', asaasData.url);

  return res.json({
    ok: true,
    redirectUrl: asaasData.url,
    message: 'Link de pagamento gerado com sucesso.',
  });
};

 const createQrcodePix = async (req, res) => {
  try {
    const { name, cpfCnpj, email, mobilePhone, value, id } = req.body;

    // 🔹 1. Verificar se cliente já existe (pelo CPF/CNPJ)
    let customerId;
    const searchResponse = await axios.get(
      `https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY,
        },
      }

    );

    if (searchResponse.data.totalCount > 0) {
      // Cliente já cadastrado
      customerId = searchResponse.data.data[0].id;
    } else {
      // 🔹 2. Criar novo cliente
      const customerData = {
        name,
        cpfCnpj,
        email,
        mobilePhone,
      };

      const customerResponse = await axios.post(
        'https://api.asaas.com/v3/customers',
        customerData,
        {
          headers: {
            'Content-Type': 'application/json',
            'access_token': process.env.ASAAS_API_KEY,
          },
        }
      );

      customerId = customerResponse.data.id;
    }

  const classUser = await Class.create({nameUser: name, id: customerId});
    // 🔹 3. Criar cobrança PIX
    const paymentData = {
      customer: customerId,
      billingType: 'PIX',
      value,
      description: 'Pagamento via PIX',
      externalReference: JSON.stringify({ teacherId: id||"teste"}),
      dueDate: new Date().toISOString().split('T')[0], // formato YYYY-MM-DD
    };

    

    const paymentResponse = await axios.post(
      'https://api.asaas.com/v3/payments',
      paymentData,
      {
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY,
        },
      }
    );

    const paymentId = paymentResponse.data.id;

    // 🔹 4. Gerar QR Code PIX
    const qrcodeResponse = await axios.get(
      `https://api.asaas.com/v3/payments/${paymentId}/pixQrCode`,
      {
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY,
        },
      }
    );

    // 🔹 5. Retornar QR Code e payload para o frontend
    return res.status(200).json({
      success: true,
      paymentId,
      encodedImage: qrcodeResponse.data.encodedImage, // imagem base64
      payload: qrcodeResponse.data.payload, // código copia e cola
    });

  } catch (error) {
    console.error('Erro ao gerar QR Code PIX:', error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: 'Erro ao gerar QR Code PIX',
      error: error.response?.data || error.message,
    });
  }
};

const createCreditCardPayment = async (req, res) => {
  try {
    // Dados obrigatórios para Cliente
    const { 
      name, 
      cpfCnpj, 
      email, 
      mobilePhone, 
      value,
      // Dados para o Cartão de Crédito
      creditCardNumber,
      creditCardBrand,
      creditCardCcv,
      creditCardHolderName,
      creditCardExpiryMonth,
      creditCardExpiryYear,
      // Dados do Titular do Cartão
      holderName, // Nome do titular (pode ser diferente do cliente da cobrança)
      holderEmail,
      holderCpfCnpj,
      holderPostalCode,
      holderAddressNumber,
      id
    } = req.body;

    const ASAAS_API_URL = "https://api.asaas.com/v3/"

    // Validação básica dos dados essenciais (pode ser expandida)
    if (!name || !cpfCnpj || !value || !creditCardNumber) {
        return res.status(400).json({ 
            success: false, 
            message: 'Campos obrigatórios ausentes para cliente e/ou pagamento.' 
        });
    }

    

    // 1. 🔍 Verificar se cliente já existe (pelo CPF/CNPJ)
    let customerId;
    const searchResponse = await axios.get(
      `${ASAAS_API_URL}/customers?cpfCnpj=${cpfCnpj}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY,
        },
      }
    );

    if (searchResponse.data.totalCount > 0) {
      // Cliente já cadastrado
      customerId = searchResponse.data.data[0].id;
    } else {
      // 2. ➕ Criar novo cliente
      const customerData = {
        name,
        cpfCnpj,
        email,
        mobilePhone,
      };

        await Class.create({nameUser: name});

      const customerResponse = await axios.post(
        `${ASAAS_API_URL}/customers`,
        customerData,
        {
          headers: {
            'Content-Type': 'application/json',
            'access_token': process.env.ASAAS_API_KEY, 
          },
        }
      );

      customerId = customerResponse.data.id;
    }

    // 3. 💳 Criar cobrança de Cartão de Crédito
    const paymentData = {
      customer: customerId,
      billingType: 'CREDIT_CARD', // Tipo de cobrança Cartão de Crédito
      value,
      description: 'Pagamento via Cartão de Crédito',
      dueDate: new Date().toISOString().split('T')[0],
       externalReference: JSON.stringify({ teacherId: id||"teste"}),
      
      // Detalhes do Cartão de Crédito
      creditCard: {
        holderName: creditCardHolderName,
        number: creditCardNumber,
        expiryMonth: creditCardExpiryMonth,
        expiryYear: creditCardExpiryYear,
        ccv: creditCardCcv
      },

      // Informações do Titular do Cartão (usado para Antifraude e processamento)
      creditCardHolderInfo: {
        name: holderName || name, // Usa o nome do titular ou o nome do cliente
        email: holderEmail || email, // Usa o email do titular ou o email do cliente
        cpfCnpj: holderCpfCnpj || cpfCnpj, // Usa o CPF/CNPJ do titular ou o CPF/CNPJ do cliente
        postalCode: holderPostalCode,
        addressNumber: holderAddressNumber
        // Outros campos como phone, mobilePhone podem ser adicionados
      },
      
      // Você pode adicionar 'externalReference' para identificar a cobrança no seu sistema.
      // externalReference: 'ref-12345', 
    };

    // Obs: Se você quiser **tokenizar** o cartão para futuras cobranças,
    // o Asaas tem um endpoint para isso, ou você pode usar 'creditCardToken'
    // no lugar de 'creditCard' se já tiver o token.
    
    const paymentResponse = await axios.post(
      `${ASAAS_API_URL}/payments`,
      paymentData,
      {
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY,
        },
      }
    );

    const paymentId = paymentResponse.data.id;
    const paymentStatus = paymentResponse.data.status;
    const transactionId = paymentResponse.data.transactionReceiptUrl; // URL do comprovante

    const classUser = await Class.create({nameUser: name, id: customerId});

    // 4. ✅ Retornar o resultado do pagamento
    return res.status(200).json({
      success: true,
      message: `Cobrança criada com sucesso. Status: ${paymentStatus}`,
      paymentId,
      status: paymentStatus,
      transactionReceiptUrl: transactionId,
      fullResponse: paymentResponse.data
    });

  } catch (error) {
    console.error('⚠️ Erro ao criar cobrança com Cartão de Crédito:', error.response?.data || error.message);

    // Tratamento de erro detalhado
    const errorMessage = error.response?.data?.errors?.[0]?.description || error.message;

    return res.status(error.response?.status || 500).json({
      success: false,
      message: 'Erro ao processar cobrança com Cartão de Crédito',
      errorDetail: errorMessage,
      fullError: error.response?.data || error.message,
    });
  }
};

const findPaymentsClass = async ( req, res ) => {
  const {name} = req.body;

  const result = await Class.findOne({nameUser: name});

  res.send(result.isPay);
}


const BuyProductTransparentPix = async (req, res) => {
  try {
    const { product, buyerData } = req.body;

    // === 1. Calcular frete se necessário ===
    const objectProduct = {
      cepOrigem: product.CEP,
      cepDestino: buyerData.cepDestino,
      pesoKg: product.weight,
      alturaCm: product.height,
      larguraCM: product.width
    };

    let valueFrete = 0;
    if (product.frete === true) {
      // Assumindo que calcularFrete retorna um objeto com 'valor_estimado'
      valueFrete = (await calcularFrete(objectProduct)).valor_estimado; 
    }
    
    // CORREÇÃO 1: Usar product.name
    const paymentRecord = await Payment.create({
      nameBuyer: buyerData.name,
      productName: product.name, 
      address: buyerData.address,
      frete: valueFrete, // Usar valueFrete já calculado para evitar chamada duplicada
      isPaid: false,
    });

    // === 2. Calcular valor total ===
    const totalValue = Number(product.value) + Number(valueFrete);

    // === 3. Buscar ou criar cliente no Asaas ===
    const { name, cpfCnpj, email, mobilePhone } = buyerData;
    let customerId;

    const searchResponse = await axios.get(
      `https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_API_KEY
        },
      }
    );

    if (searchResponse.data.totalCount > 0) {
      // cliente já existe
      customerId = searchResponse.data.data[0].id;
    } else {
      // criar cliente
      const customerData = { name, cpfCnpj, email, mobilePhone };
      const customerResponse = await axios.post(
        "https://api.asaas.com/v3/customers",
        customerData,
        {
          headers: {
            "Content-Type": "application/json",
            "access_token": process.env.ASAAS_API_KEY
          },
        }
      );
      customerId = customerResponse.data.id;
    }

    // === 4. Criar cobrança PIX ===
    const paymentData = {
      customer: customerId,
      billingType: "PIX",
      value: totalValue,
      // CORREÇÃO 2: Usar product.name
      description: `Compra do produto ${product.name}${
        product.frete ? " + frete incluso" : ""
      }`,
      dueDate: new Date().toISOString().split("T")[0], // formato YYYY-MM-DD
      externalReference: paymentRecord.id.toString()
    };

    const paymentResponse = await axios.post(
      "https://api.asaas.com/v3/payments",
      paymentData,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_API_KEY
        },
      }
    );

    const paymentId = paymentResponse.data.id;

    // === 5. Gerar QR Code PIX ===
    const qrcodeResponse = await axios.get(
      `https://api.asaas.com/v3/payments/${paymentId}/pixQrCode`,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_API_KEY
        },
      }
    );

    // === 6. Retornar resultado ao frontend ===
    return res.status(200).json({
      success: true,
      message: "Checkout PIX criado com sucesso!",
      paymentId,
      totalValue,
      valueFrete,
      encodedImage: qrcodeResponse.data.encodedImage,
      payload: qrcodeResponse.data.payload,
    });

  } catch (error) {
    console.error("Erro no checkout transparente PIX:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Erro ao processar o checkout PIX",
      error: error.response?.data || error.message,
    });
  }
};

const BuyProductTransparentCreditCard = async (req, res) => {
  try {
    // Desestruturação dos dados recebidos
    const { 
      product, 
      buyerData, 
      cardData, // Dados do cartão de crédito (número, validade, ccv, etc.)
      installments = 1 // Número de parcelas (padrão 1)
    } = req.body;

    const ASAAS_API_URL = "https://api.asaas.com/v3/";

    // Validação básica
    if (!product || !buyerData || !cardData || !cardData.creditCardNumber) {
        return res.status(400).json({ 
            success: false, 
            message: 'Dados de produto, comprador e/ou cartão incompletos.' 
        });
    }

    // === 1. Calcular frete se necessário ===
    const objectProduct = {
      cepOrigem: product.CEP,
      cepDestino: buyerData.cepDestino,
      pesoKg: product.weight,
      alturaCm: product.height,
      larguraCM: product.width
    };

    let valueFrete = 0;
    if (product.frete === true) {
      // Assumindo que calcularFrete é importado e funciona corretamente
      valueFrete = (await calcularFrete(objectProduct)).valor_estimado; 
    }

    // === 2. Calcular valor total ===
    const totalValue = Number(product.value) + Number(valueFrete);
     
    // 2.1. Criar registro de pagamento (opcional, mas bom para rastreamento)
    const paymentRecord = await Payment.create({
      nameBuyer: buyerData.name,
      productName: product.name, // Usando .name conforme correção
      address: buyerData.address,
      frete: valueFrete, 
      isPaid: false, // O pagamento ainda está sendo processado
    });


    // === 3. Buscar ou criar cliente no Asaas ===
    const { name, cpfCnpj, email, mobilePhone } = buyerData;
    let customerId;

    const searchResponse = await axios.get(
      `${ASAAS_API_URL}customers?cpfCnpj=${cpfCnpj}`,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_API_KEY
        },
      }
    );

    if (searchResponse.data.totalCount > 0) {
      customerId = searchResponse.data.data[0].id;
    } else {
      const customerData = { name, cpfCnpj, email, mobilePhone };
      const customerResponse = await axios.post(
        `${ASAAS_API_URL}customers`,
        customerData,
        {
          headers: {
            "Content-Type": "application/json",
            "access_token": process.env.ASAAS_API_KEY
          },
        }
      );
      customerId = customerResponse.data.id;
    }

    // === 4. Criar cobrança de Cartão de Crédito ===
    const paymentData = {
      customer: customerId,
      billingType: "CREDIT_CARD", // Tipo de cobrança
      value: totalValue,
      installmentCount: installments, // Número de parcelas
      installmentValue: totalValue / installments, // Valor da parcela
      description: `Compra do produto ${product.name} (CC)${
        product.frete ? " + frete incluso" : ""
      }`,
      dueDate: new Date().toISOString().split("T")[0], // Data de vencimento
      externalReference: paymentRecord.id.toString(), // Referência ao seu registro

      // Detalhes do Cartão de Crédito
      creditCard: {
        holderName: cardData.creditCardHolderName,
        number: cardData.creditCardNumber,
        expiryMonth: cardData.creditCardExpiryMonth,
        expiryYear: cardData.creditCardExpiryYear,
        ccv: cardData.creditCardCcv
      },

      // Informações do Titular do Cartão (Antifraude)
      creditCardHolderInfo: {
        name: cardData.holderName || name, 
        email: cardData.holderEmail || email, 
        cpfCnpj: cardData.holderCpfCnpj || cpfCnpj, 
        postalCode: cardData.holderPostalCode || buyerData.cepDestino, // Assumindo que o CEP do cartão é o de destino se não fornecido
        addressNumber: cardData.holderAddressNumber || buyerData.addressNumber 
        // ... outros campos ...
      },
    };

    const paymentResponse = await axios.post(
      `${ASAAS_API_URL}payments`,
      paymentData,
      {
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_API_KEY
        },
      }
    );

    const paymentId = paymentResponse.data.id;
    const paymentStatus = paymentResponse.data.status;
    const transactionReceiptUrl = paymentResponse.data.transactionReceiptUrl; // URL do comprovante

    // === 5. Atualizar o registro de pagamento (importante!) ===
    // Você deve atualizar o PaymentRecord com o ID do Asaas e o status
    await Payment.findByIdAndUpdate(paymentRecord.id, {
      paymentIdAsaas: paymentId,
      isPaid: (paymentStatus === 'CONFIRMED' || paymentStatus === 'RECEIVED'),
      status: paymentStatus
    });


    // === 6. Retornar resultado ao frontend ===
    return res.status(200).json({
      success: true,
      message: `Checkout Cartão de Crédito processado com sucesso. Status: ${paymentStatus}`,
      paymentId,
      status: paymentStatus,
      totalValue,
      valueFrete,
      transactionReceiptUrl,
    });

  } catch (error) {
    console.error("⚠️ Erro no checkout transparente Cartão de Crédito:", error.response?.data || error.message);
    
    // Tratamento de erro detalhado
    const errorMessage = error.response?.data?.errors?.[0]?.description || error.message;

    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Erro ao processar o checkout Cartão de Crédito",
      errorDetail: errorMessage,
      fullError: error.response?.data || error.message,
    });
  }
};

module.exports = {
  BuyProduct,
  Webhook,
  PayPerClass,
  createQrcodePix,
  createCreditCardPayment,
  findPaymentsClass,
  BuyProductTransparentPix,
  BuyProductTransparentCreditCard
};
