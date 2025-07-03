require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago'); 
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; 

// --- CONFIGURAÇÕES IMPORTANTES ---
// **SUAS URLs REAIS DO RENDER**
// Lembre-se de ajustar estas URLs para as suas URLs reais no Render.
// Com base nas informações anteriores, your backend URL é https://apihook.onrender.com
const YOUR_FRONTEND_RENDER_URL = "https://acaiemcasasite.onrender.com"; 
const YOUR_BACKEND_RENDER_URL = "https://apihook.onrender.com"; 

// **INICIALIZAÇÃO DA SDK DO MERCADO PAGO (CORRIGIDA PARA V2.x)**
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN 
});
// A classe Preference é mantida para compatibilidade, mas não será usada nesta rota.
const preference = new Preference(client); 
// A classe Payment é usada para buscar detalhes de pagamentos existentes (para webhooks)
// E AGORA SERÁ USADA PARA CRIAR PAGAMENTOS DIRETOS (PIX)
const payment = new Payment(client); 


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

        let totalForPayment = totalAmount; // Usar o totalAmount que vem do frontend

        // Constrói uma descrição geral do pedido para o Mercado Pago
        const description = cartItems.map(item => {
            let itemDesc = item.productName;
            if (item.complements && item.complements.length > 0) {
                const compNames = item.complements.map(c => c.name).join(', ');
                itemDesc += ` (${compNames})`;
            }
            return itemDesc;
        }).join('; '); // Itens separados por ponto e vírgula
        
        // Limita a descrição a um tamanho razoável se necessário pelo MP (ex: 60 ou 250 caracteres)
        const finalDescription = `Pedido Açaí: ${description.substring(0, 250)}`; 

        // --- CORPO DA REQUISIÇÃO PARA A PAYMENTS API (PARA PIX) ---
        const paymentData = {
            transaction_amount: parseFloat(totalForPayment.toFixed(2)), // Valor total da transação
            description: finalDescription, // Descrição geral para o MP
            payment_method_id: 'pix', // **CRÍTICO: Especifica Pix como método de pagamento**
            payer: {
                email: "test_user_123456@test.com", // Email do pagador (dummy se não coletado, mas é obrigatório/altamente recomendado)
                first_name: customerName, // Nome do pagador
                // Opcional: Adicione mais dados do pagador se coletar no frontend (ex: CPF)
                // identification: { type: "CPF", number: "123.456.789-00" } 
            },
            // metadata é útil para passar o external_reference ou outros dados que não se encaixam em outros campos
            metadata: {
                external_reference_app: externalReference, // Usar um nome diferente para evitar conflitos diretos
                customer_name_app: customerName,
                // ... outros dados que queira salvar com o pagamento no MP, que serão retornados no webhook
            },
            external_reference: externalReference, // Campo do MP para vincular ao seu ID de pedido
            notification_url: `${YOUR_BACKEND_RENDER_URL}/mercadopago-webhook`, // Webhook para o backend
            //point_of_interaction: {} // Não é necessário preencher, o MP o preenche
        };

        // --- NOVO LOG: Dados enviados à Payments API para Pix (paymentData) ---
        console.log('Dados enviados à Payments API para Pix (paymentData):', JSON.stringify(paymentData, null, 2));

        // **CHAMADA PARA CRIAR O PAGAMENTO (CORRIGIDA PARA Payments API)**
        const response = await payment.create({ body: paymentData });
        
        // --- NOVO LOG: Resposta COMPLETA da Payments API ---
        console.log('Resposta COMPLETA da Payments API:', JSON.stringify(response, null, 2));


        // Agora, a resposta DEVE conter point_of_interaction.transaction_data.
        if (!response || !response.body || !response.body.point_of_interaction || !response.body.point_of_interaction.transaction_data) {
            console.error('Estrutura de resposta inesperada da Payments API (falha no point_of_interaction):', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                status: 'error', 
                message: 'Resposta da Payments API não contém dados de Pix esperados.', 
                details: response ? (response.body || response) : 'Resposta vazia.' 
            });
        }

        const pixInfo = response.body.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Pagamento Pix criado com sucesso.',
            paymentId: response.body.id, // ID do pagamento recém-criado
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

    if (req.query.topic === 'payment') {
        const paymentId = req.query.id; 

        try {
            const paymentDetails = await payment.get({ id: paymentId }); 
            const paymentStatus = paymentDetails.body.status; 
            const externalReference = paymentDetails.body.external_reference; 

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
        console.log(`Webhook recebido, mas tópico '${req.query.topic}' não é de pagamento. Ignorando.`);
        res.status(200).send('Webhook recebido, mas tópico não relevante para esta aplicação.');
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
