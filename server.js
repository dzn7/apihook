require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago'); 
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CONFIGURAÇÕES IMPORTANTES ---
// **SUAS URLs REAIS DO RENDER**
const YOUR_FRONTEND_RENDER_URL = "https://acaiemcasasite.onrender.com"; 
const YOUR_BACKEND_RENDER_URL = "https://apihook.onrender.com"; 

// **INICIALIZAÇÃO DA SDK DO MERCADO PAGO (CORRIGIDA PARA V2.x)**
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
});
const preference = new Preference(client); // Mantida, mas não usada nesta rota.
const payment = new Payment(client); // Usaremos esta instância.


// Middleware para habilitar CORS
app.use(cors({
    origin: YOUR_FRONTEND_RENDER_URL 
})); 

// Middleware para parsear o corpo das requisições como JSON
app.use(express.json());

// Rota para criar um pagamento Pix
app.post('/create-mercadopago-pix', async (req, res) => {
    try {
        const { customerName, cartItems, delivery, totalAmount, externalReference } = req.body;

        if (!customerName || !cartItems || cartItems.length === 0 || !totalAmount || !externalReference) {
            console.error('Dados do pedido incompletos na requisição Pix:', req.body);
            return res.status(400).json({ status: 'error', message: 'Dados do pedido incompletos.' });
        }

        let totalForPayment = totalAmount; 

        const description = cartItems.map(item => {
            let itemDesc = item.productName;
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

        const response = await payment.create({ body: paymentData }); // A resposta da SDK v2 é direta

        console.log('Resposta COMPLETA da Payments API:', JSON.stringify(response, null, 2));


        // **VERIFICAÇÃO CORRIGIDA:** Acessa as propriedades diretamente do objeto 'response'
        if (!response || !response.point_of_interaction || !response.point_of_interaction.transaction_data) {
            console.error('Estrutura de resposta inesperada da Payments API (falha no point_of_interaction):', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                status: 'error', 
                message: 'Resposta da Payments API não contém dados de Pix esperados.', 
                details: response ? response : 'Resposta vazia.' // Retorna o objeto response inteiro para depuração
            });
        }

        // **ACESSO CORRIGIDO:** Acessa as propriedades diretamente do objeto 'response'
        const pixInfo = response.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Pagamento Pix criado com sucesso.',
            paymentId: response.id, // **ACESSO CORRIGIDO:** ID do pagamento recém-criado
            qr_code_base64: pixInfo.qr_code_base64, 
            qr_code: pixInfo.qr_code,             
        });

    } catch (error) {
        console.error('Erro geral na rota /create-mercadopago-pix (Payments API):', 
            error.response ? error.response.data : error.message, 
            error.response ? `HTTP Status: ${error.response.status}` : '' 
        );
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro ao processar o pagamento com Mercado Pago (Payments API). Tente novamente.', 
            details: error.response ? (error.response.data || error.message) : error.message 
        });
    }
});

// Rota de Webhook para receber notificações do Mercado Pago
app.post('/mercadopago-webhook', async (req, res) => {
    console.log(`--- Webhook do Mercado Pago recebido (Timestamp: ${new Date().toISOString()}) ---`);
    console.log('Query Params (topic, id):', req.query); 
    console.log('Corpo da Requisição Webhook:', req.body); 

    // O Mercado Pago envia notificações para vários tópicos. O mais importante é 'payment'.
    // A query param 'id' pode vir em 'req.query.id' OU 'req.query.data.id' dependendo do tipo de notificação.
    // O 'topic' é o que define o tipo de evento (ex: 'payment').
    const topic = req.query.topic || req.body.type; // Tenta pegar de req.query ou req.body
    const notificationId = req.query.id || req.body.data?.id; // Tenta pegar de req.query ou req.body.data.id

    if (topic === 'payment' && notificationId) { // Verifica se é um tópico 'payment' e se tem um ID
        const paymentId = notificationId; 

        try {
            const paymentDetails = await payment.get({ id: paymentId }); // Retorna o objeto de pagamento direto

            // **ACESSO CORRIGIDO:** Acessa as propriedades diretamente do objeto 'paymentDetails'
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
        console.log(`Webhook recebido, mas tópico '${topic}' ou ID '${notificationId}' não é de pagamento válido. Ignorando.`);
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
