require('dotenv').config();

const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES IMPORTANTES ---
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!accessToken) {
    console.error("ERRO CRÍTICO: MERCADOPAGO_ACCESS_TOKEN não está definido no .env!");
    process.exit(1);
}

const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

// --- CONFIGURAÇÃO DE CORS (Permite múltiplos domínios) ---
const allowedOrigins = [
    'https://acaiemcasasite.onrender.com',
    'https://edienayteste.onrender.com',
    'http://localhost:3000', // Para testes locais
    'http://127.0.0.1:5500'  // Para testes locais com Live Server
];

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());

// --- ROTAS DA APLICAÇÃO ---

// ROTA PARA CRIAR PAGAMENTO PIX
app.post('/create-mercadopago-pix', async (req, res) => {
    try {
        const { customerName, customerEmail, items, total } = req.body;

        if (!customerName || !customerEmail || !items || items.length === 0 || !total) {
            console.error('Dados do pedido Pix incompletos:', req.body);
            return res.status(400).json({ message: 'Dados do pedido incompletos.' });
        }

        const externalReference = uuidv4();
        const description = `Pedido para ${customerName}: ${items.map(item => item.name).join(', ')}`.substring(0, 255);

        const paymentData = {
            transaction_amount: parseFloat(total.toFixed(2)),
            description: description,
            payment_method_id: 'pix',
            payer: {
                email: customerEmail,
                first_name: customerName,
            },
            external_reference: externalReference,
            notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`,
        };

        const paymentResponse = await payment.create({ body: paymentData });
        
        const pixInfo = paymentResponse.point_of_interaction.transaction_data;
        res.status(200).json({
            paymentId: paymentResponse.id,
            qrCodeImage: `data:image/png;base64,${pixInfo.qr_code_base64}`,
            pixCopiaECola: pixInfo.qr_code,
        });

    } catch (error) {
        console.error('Erro em /create-mercadopago-pix:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao criar pagamento Pix.', details: error.cause });
    }
});

// ROTA PARA CRIAR PAGAMENTO COM CARTÃO
app.post('/create-mercadopago-card', async (req, res) => {
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, external_reference, description } = req.body;

        if (!token || !transaction_amount || !installments || !payer || !payer.email) {
             console.error('Dados do pagamento com cartão incompletos:', req.body);
            return res.status(400).json({ message: 'Dados do pagamento com cartão incompletos.' });
        }

        const paymentData = {
            token,
            issuer_id,
            payment_method_id,
            transaction_amount: parseFloat(transaction_amount.toFixed(2)),
            installments,
            payer,
            external_reference,
            description,
            notification_url: `${process.env.BACKEND_URL}/mercadopago-webhook`,
        };

        const paymentResponse = await payment.create({ body: paymentData });
        
        res.status(201).json({
            status: paymentResponse.status,
            status_detail: paymentResponse.status_detail,
            id: paymentResponse.id,
        });

    } catch (error) {
        console.error('Erro em /create-mercadopago-card:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao processar pagamento com cartão.', details: error.cause });
    }
});

// ROTA DE WEBHOOK
app.post('/mercadopago-webhook', (req, res) => {
    console.log('--- Webhook Recebido ---');
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    
    // Responde rapidamente ao Mercado Pago para evitar timeouts
    res.sendStatus(200);

    // Processamento do webhook (ex: confirmar pedido no banco de dados)
    const topic = req.query.topic || req.body.topic;
    if (topic === 'payment' || req.body.type === 'payment') {
        const paymentId = req.query.id || req.body.data.id;
        console.log(`Webhook de pagamento recebido para o ID: ${paymentId}`);
        
        // Aqui você pode adicionar lógica para processar o webhook
        // Por exemplo: verificar status do pagamento, atualizar banco de dados, etc.
    }
});

// ROTA DE TESTE
app.get('/', (req, res) => {
    res.json({ 
        message: 'API Mercado Pago - Açaí em Casa', 
        status: 'Online',
        timestamp: new Date().toISOString() 
    });
});

// ROTA DE HEALTH CHECK
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💳 Mercado Pago configurado: ${accessToken ? 'SIM' : 'NÃO'}`);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promise rejeitada não tratada:', reason);
    process.exit(1);
});
