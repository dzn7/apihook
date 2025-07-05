// VERSÃO CORRIGIDA E COM DIAGNÓSTICO DO server.js

require('dotenv').config();

const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES IMPORTANTES ---
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!accessToken) {
    console.error("ERRO CRÍTICO: MERCADOPAGO_ACCESS_TOKEN não está definido no .env!");
    process.exit(1);
}

// Validação do token de acesso
console.log('🔑 Token configurado:', accessToken ? `${accessToken.substring(0, 10)}...` : 'NÃO CONFIGURADO');

const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

// --- CONFIGURAÇÃO DE CORS (Permite múltiplos domínios) ---
const allowedOrigins = [
    'https://acaiemcasasite.onrender.com',
    'https://edienayteste.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
];

const corsOptions = {
  origin: function (origin, callback) {
    console.log('🌐 Origem da requisição:', origin);
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());

// Middleware para log de requisições
app.use((req, res, next) => {
    console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// --- ROTAS DA APLICAÇÃO ---

// ROTA PARA CRIAR PAGAMENTO PIX (VERSÃO CORRIGIDA)
app.post('/create-mercadopago-pix', async (req, res) => {
    console.log('🔄 Iniciando criação de pagamento PIX...');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const { customerName, customerEmail, items, total } = req.body;

        // Validação mais detalhada dos dados
        const validationErrors = [];
        
        if (!customerName || typeof customerName !== 'string' || customerName.trim() === '') {
            validationErrors.push('customerName é obrigatório e deve ser uma string não vazia');
        }
        
        if (!customerEmail || typeof customerEmail !== 'string' || !customerEmail.includes('@')) {
            validationErrors.push('customerEmail é obrigatório e deve ser um email válido');
        }
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            validationErrors.push('items é obrigatório e deve ser um array não vazio');
        }
        
        if (!total || typeof total !== 'number' || total <= 0) {
            validationErrors.push('total é obrigatório e deve ser um número maior que zero');
        }

        if (validationErrors.length > 0) {
            console.error('❌ Erros de validação:', validationErrors);
            return res.status(400).json({ 
                message: 'Dados do pedido incompletos ou inválidos.',
                errors: validationErrors,
                receivedData: req.body
            });
        }

        // Geração de referência externa única
        const externalReference = `acai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Descrição do pedido (limitada a 255 caracteres)
        const itemsDescription = items.map(item => `${item.name} (${item.quantity}x)`).join(', ');
        const description = `Pedido Açaí em Casa - ${customerName}: ${itemsDescription}`.substring(0, 255);

        console.log('🏷️ Referência externa:', externalReference);
        console.log('📝 Descrição:', description);

        // Dados do pagamento PIX
        const paymentData = {
            transaction_amount: parseFloat(total.toFixed(2)),
            description: description,
            payment_method_id: 'pix',
            payer: {
                email: customerEmail.trim(),
                first_name: customerName.trim(),
            },
            external_reference: externalReference,
            notification_url: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mercadopago-webhook` : undefined,
        };

        console.log('💳 Dados do pagamento PIX:', JSON.stringify(paymentData, null, 2));

        // Criação do pagamento no Mercado Pago
        console.log('⏳ Enviando requisição para Mercado Pago...');
        const paymentResponse = await payment.create({ body: paymentData });
        
        console.log('✅ Resposta do Mercado Pago:', JSON.stringify(paymentResponse, null, 2));

        // Validação da resposta do Mercado Pago
        if (!paymentResponse || !paymentResponse.id) {
            throw new Error('Resposta inválida do Mercado Pago: ID do pagamento não encontrado');
        }

        if (!paymentResponse.point_of_interaction || !paymentResponse.point_of_interaction.transaction_data) {
            throw new Error('Dados do PIX não encontrados na resposta do Mercado Pago');
        }

        const pixInfo = paymentResponse.point_of_interaction.transaction_data;
        
        if (!pixInfo.qr_code_base64 || !pixInfo.qr_code) {
            throw new Error('QR Code PIX não foi gerado corretamente');
        }

        const response = {
            paymentId: paymentResponse.id,
            qrCodeImage: `data:image/png;base64,${pixInfo.qr_code_base64}`,
            pixCopiaECola: pixInfo.qr_code,
            status: paymentResponse.status,
            externalReference: externalReference
        };

        console.log('🎉 Pagamento PIX criado com sucesso!');
        console.log('📊 Resposta enviada:', JSON.stringify(response, null, 2));

        res.status(200).json(response);

    } catch (error) {
        console.error('💥 ERRO DETALHADO em /create-mercadopago-pix:');
        console.error('Tipo do erro:', error.constructor.name);
        console.error('Mensagem:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Log específico para erros do Mercado Pago
        if (error.cause) {
            console.error('Causa do erro:', JSON.stringify(error.cause, null, 2));
        }
        
        if (error.response) {
            console.error('Resposta do erro:', JSON.stringify(error.response, null, 2));
        }

        // Resposta de erro mais informativa
        const errorResponse = {
            message: 'Erro ao criar pagamento Pix.',
            details: error.message,
            timestamp: new Date().toISOString(),
            // Incluir mais detalhes em desenvolvimento
            ...(process.env.NODE_ENV === 'development' && {
                stack: error.stack,
                cause: error.cause
            })
        };

        res.status(500).json(errorResponse);
    }
});

// ROTA PARA CRIAR PAGAMENTO COM CARTÃO (mantida igual)
app.post('/create-mercadopago-card', async (req, res) => {
    console.log('🔄 Iniciando criação de pagamento com cartão...');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, external_reference, description } = req.body;

        if (!token || !transaction_amount || !installments || !payer || !payer.email) {
            console.error('❌ Dados do pagamento com cartão incompletos:', req.body);
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
            notification_url: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mercadopago-webhook` : undefined,
        };

        console.log('💳 Dados do pagamento cartão:', JSON.stringify(paymentData, null, 2));

        const paymentResponse = await payment.create({ body: paymentData });
        
        console.log('✅ Resposta do Mercado Pago (cartão):', JSON.stringify(paymentResponse, null, 2));

        res.status(201).json({
            status: paymentResponse.status,
            status_detail: paymentResponse.status_detail,
            id: paymentResponse.id,
        });

    } catch (error) {
        console.error('💥 Erro em /create-mercadopago-card:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao processar pagamento com cartão.', details: error.cause || error.message });
    }
});

// ROTA DE WEBHOOK (melhorada)
app.post('/mercadopago-webhook', (req, res) => {
    console.log('🔔 --- Webhook Recebido ---');
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    console.log('Headers:', req.headers);
    
    // Responde rapidamente ao Mercado Pago para evitar timeouts
    res.sendStatus(200);

    // Processamento do webhook
    const topic = req.query.topic || req.body.topic;
    if (topic === 'payment' || req.body.type === 'payment') {
        const paymentId = req.query.id || req.body.data?.id;
        console.log(`💰 Webhook de pagamento recebido para o ID: ${paymentId}`);
        
        // Aqui você pode adicionar lógica para processar o webhook
        // Por exemplo: verificar status do pagamento, atualizar banco de dados, etc.
    }
});

// ROTA DE TESTE
app.get('/', (req, res) => {
    res.json({ 
        message: 'API Mercado Pago - Açaí em Casa', 
        status: 'Online',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        mercadoPagoConfigured: !!accessToken
    });
});

// ROTA DE HEALTH CHECK
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

// ROTA DE DEBUG (para desenvolvimento)
app.get('/debug', (req, res) => {
    res.json({
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        mercadoPagoToken: accessToken ? 'Configurado' : 'Não configurado',
        backendUrl: process.env.BACKEND_URL || 'Não configurado',
        allowedOrigins: allowedOrigins
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💳 Mercado Pago configurado: ${accessToken ? 'SIM' : 'NÃO'}`);
    console.log(`🔗 Backend URL: ${process.env.BACKEND_URL || 'Não configurado'}`);
    console.log(`🎯 Origens permitidas:`, allowedOrigins);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('💥 Erro não capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Promise rejeitada não tratada:', reason);
    process.exit(1);
});
