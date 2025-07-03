require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid'); // Para gerar externalReference único

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES IMPORTANTES ---
const YOUR_FRONTEND_RENDER_URL = process.env.FRONTEND_URL || "https://acaiemcasasite.onrender.com";
const YOUR_BACKEND_RENDER_URL = process.env.BACKEND_URL || "https://apihook.onrender.com";

const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});
const payment = new Payment(client);

// Middleware para habilitar CORS
app.use(cors({
    origin: YOUR_FRONTEND_RENDER_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// TRATAMENTO ESPECÍFICO PARA REQUISIÇÕES PREFLIGHT (OPTIONS)
app.options('*', cors());

// Middleware para parsear o corpo das requisições como JSON
app.use(express.json());

// Rota para criar um pagamento Pix
app.post('/create-mercadopago-pix', async (req, res) => {
    try {
        const { customerName, cartItems, delivery, totalAmount } = req.body;

        // ***** AQUI ESTÁ A ÚNICA MUDANÇA: REMOÇÃO DE '!externalReference' *****
        if (!customerName || !cartItems || cartItems.length === 0 || !totalAmount) {
            console.error('Dados do pedido incompletos na requisição Pix:', req.body);
            return res.status(400).json({ status: 'error', message: 'Dados do pedido incompletos.' });
        }

        const externalReference = uuidv4(); // Gerar um ID único para o pedido
        let totalForPayment = totalAmount;

        const description = cartItems.map(item => {
            let itemDesc = item.name;
            if (item.complements && item.complements.length > 0) {
                const compNames = item.complements.map(c => c.name).join(', ');
                itemDesc += ` (${compNames})`;
            }
            return itemDesc;
        }).join('; ');

        const finalDescription = `Pedido Açaí: ${description.substring(0, 250)}`;

        const paymentData = {
            transaction_amount: parseFloat(totalForPayment.toFixed(2)),
            description: finalDescription,
            payment_method_id: 'pix',
            payer: {
                email: "test_user_123456@test.com",
                first_name: customerName,
            },
            metadata: {
                external_reference_app: externalReference,
                customer_name_app: customerName,
            },
            external_reference: externalReference,
            notification_url: `${YOUR_BACKEND_RENDER_URL}/mercadopago-webhook`,
        };

        console.log('Dados enviados à Payments API para Pix (paymentData):', JSON.stringify(paymentData, null, 2));

        const paymentResponse = await payment.create({ body: paymentData });

        console.log('Resposta COMPLETA da Payments API (criação):', JSON.stringify(paymentResponse, null, 2));

        if (!paymentResponse || !paymentResponse.point_of_interaction || !paymentResponse.point_of_interaction.transaction_data || !paymentResponse.point_of_interaction.transaction_data.qr_code_base64 || !paymentResponse.point_of_interaction.transaction_data.qr_code) {
            console.error('Estrutura de resposta inesperada ou Pix data ausente:', JSON.stringify(paymentResponse, null, 2));
            return res.status(500).json({
                status: 'error',
                message: 'Erro: Dados do QR Code não encontrados na resposta do Mercado Pago. Verifique sua conta ou configurações.',
                details: paymentResponse ? paymentResponse : 'Resposta vazia.'
            });
        }

        const pixInfo = paymentResponse.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Pagamento Pix criado com sucesso.',
            paymentId: paymentResponse.id,
            qrCodeImage: `data:image/png;base64,${pixInfo.qr_code_base64}`,
            pixCopiaECola: pixInfo.qr_code,
        });

    } catch (error) {
        console.error('Erro geral na rota /create-mercadopago-pix:',
            error.response ? error.response.data : error.message,
            error.response ? `HTTP Status: ${error.response.status}` : ''
        );
        res.status(500).json({
            status: 'error',
            message: 'Erro ao processar o pagamento com Mercado Pago. Tente novamente.',
            details: error.response ? (error.response.data || error.message) : error.message
        });
    }
});

// Rota de Webhook para receber notificações do Mercado Pago
app.post('/mercadopago-webhook', async (req, res) => {
    console.log(`--- Webhook do Mercado Pago recebido (Timestamp: ${new Date().toISOString()}) ---`);
    console.log('Query Params (topic, id):', req.query);
    console.log('Corpo da Requisição Webhook:', JSON.stringify(req.body, null, 2));

    const topic = req.query.topic || req.body.topic || req.body.type;
    const notificationId = req.query.id || req.body.data?.id || req.body.resource;

    console.log(`Webhook -> Tópico Extraído: '${topic}', ID Extraído: '${notificationId}'`);

    if (topic === 'payment' && notificationId) {
        const paymentId = notificationId;

        try {
            const paymentDetails = await payment.get({ id: paymentId });

            if (!paymentDetails || typeof paymentDetails.status === 'undefined') {
                console.error('Resposta de payment.get() inesperada ou incompleta para paymentId:', paymentId, JSON.stringify(paymentDetails, null, 2));
                return res.status(500).send('Erro: Detalhes do pagamento não puderam ser obtidos ou são inválidos.');
            }

            const paymentStatus = paymentDetails.status;
            const externalReference = paymentDetails.external_reference;

            console.log(`Detalhes do Pagamento ID: ${paymentId}`);
            console.log(`Status do Pagamento: ${paymentStatus}`);
            console.log(`Referência Externa (Seu Pedido ID): ${externalReference}`);

            if (paymentStatus === 'approved') {
                console.log(`✅ Pagamento APROVADO para pedido: ${externalReference}`);
            } else if (paymentStatus === 'pending') {
                console.log(`⏳ Pagamento PENDENTE para pedido: ${externalReference}`);
            } else {
                console.log(`❌ Pagamento ${paymentStatus} para pedido: ${externalReference}`);
            }

            res.status(200).send('Webhook recebido e processado.');

        } catch (error) {
            console.error('Erro ao processar webhook do Mercado Pago para paymentId:', paymentId, error.response ? error.response.data : error.message);
            res.status(500).send('Erro interno ao processar webhook.');
        }
    } else {
        console.log(`Webhook recebido, mas tópico '${topic}' ou ID '${notificationId}' não é de pagamento válido para processamento. Ignorando.`);
        res.status(200).send('Webhook recebido, mas tópico ou ID não relevante para esta aplicação.');
    }
});

// Rota padrão para verificar se o servidor está funcionando
app.get('/', (req, res) => {
    res.send('Açaí Mercado Pago Backend está online!');
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Aguardando requisições em http://localhost:${PORT}`);
    console.log(`Seu frontend deve estar em: ${YOUR_FRONTEND_RENDER_URL}`);
    console.log(`Esta instância do backend deve estar em: ${YOUR_BACKEND_RENDER_URL}`);
});
