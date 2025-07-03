require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago'); // <-- MUDANÇA AQUI!
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Usa a porta do ambiente (Render) ou 3000 localmente

// --- CONFIGURAÇÕES IMPORTANTES ---
// **SUAS URLs REAIS DO RENDER**
const YOUR_FRONTEND_RENDER_URL = "https://acaiemcasasite.onrender.com"; // URL do seu frontend
const YOUR_BACKEND_RENDER_URL = "https://acaiemcasasite.onrender.com"; // Assumindo que o backend estará no mesmo domínio/subdomínio do Render. Ajuste se for diferente.

// **INICIALIZAÇÃO DA SDK DO MERCADO PAGO (CORRIGIDA PARA V2.x)**
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN // Lê o Access Token das variáveis de ambiente
});
// A classe Preference é usada para criar preferências de pagamento (para Pix/checkout).
const preference = new Preference(client);
// A classe Payment é usada para buscar detalhes de pagamentos existentes (para webhooks).
const payment = new Payment(client);


// Middleware para habilitar CORS
app.use(cors({
    origin: YOUR_FRONTEND_RENDER_URL // Permite apenas requisições do seu frontend
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

        const items = cartItems.map(item => ({
            title: item.productName,
            unit_price: parseFloat(item.productPrice.toFixed(2)),
            quantity: 1,
            description: item.complements && item.complements.length > 0 
                         ? 'Com: ' + item.complements.map(c => c.name).join(', ') 
                         : 'Sem complementos'
        }));

        if (delivery && delivery.cost > 0) {
            items.push({
                title: "Taxa de Entrega",
                unit_price: parseFloat(delivery.cost.toFixed(2)),
                quantity: 1
            });
        }
        
        const preferenceBody = {
            items: items,
            payer: {
                // Para Pix, é útil ter o CPF/CNPJ se for Pessoa Jurídica
                // Exemplo: identification: { type: "CPF", number: "12345678900" } 
                // email: "email_do_cliente@example.com", // Se coletar o email
                name: customerName,
            },
            notification_url: `${https://acaiemcasasite.onrender.com/}/mercadopago-webhook`, 
            
            back_urls: {
                success: `${https://acaiemcasasite.onrender.com/}/`,
                failure: `${https://acaiemcasasite.onrender.com/}/`, 
                pending: `$https://acaiemcasasite.onrender.com/}/` 
            },
            auto_return: "approved", 
            
            payment_methods: {
                excluded_payment_types: [
                    { id: "credit_card" },
                    { id: "debit_card" },
                    { id: "ticket" }
                ],
                installments: 1
            },
            external_reference: externalReference,
            // A seguir, configurações específicas para PIX para que o checkout seja focado nele:
            // binary_mode: true, // Para que o pagamento seja apenas aprovado ou rejeitado, sem pendências
            // statement_descriptor: "ACAI_EM_CASA", // O texto que aparecerá na fatura do cliente (se aplicável)
            // differential_pricing: { id: "some_id" }, // Se tiver tabela de preços diferenciada
            // sponsor_id: 1234567, // Se for um sub-vendedor
            // metadata: { "order_id": externalReference } // Metadados adicionais para seu controle
        };

        // **CHAMADA PARA CRIAR A PREFERÊNCIA (CORRIGIDA)**
        const response = await preference.create({ body: preferenceBody });
        
        const pixInfo = response.body.point_of_interaction.transaction_data;

        res.status(200).json({
            status: 'success',
            message: 'Preferência de pagamento Pix criada com sucesso.',
            paymentId: response.body.id,
            qr_code_base64: pixInfo.qr_code_base64, 
            qr_code: pixInfo.qr_code,             
        });

    } catch (error) {
        console.error('Erro ao criar preferência de pagamento:', 
            error.response ? error.response.data : error.message,
            error.response ? error.response.status : ''
        );
        res.status(500).json({ 
            status: 'error', 
            message: 'Erro ao processar o pagamento com Mercado Pago. Tente novamente.', 
            details: error.response ? error.response.data : error.message 
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
            // **CHAMADA PARA BUSCAR PAGAMENTO (CORRIGIDA)**
            const paymentDetails = await payment.get({ id: paymentId }); // Usar .get() com um objeto { id: ... }
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
