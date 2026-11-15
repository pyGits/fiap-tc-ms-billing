import { Db } from "mongodb";

import MensageriaGateway from "../domain/gateway/MensageriaGateway";
import PagamentoExternoGateway from "../domain/gateway/PagamentoExternoGateway";
import TelemetriaGateway from "../domain/gateway/TelemetriaGateway";
import MensagemProcessadaRepository from "../domain/repository/MensagemProcessadaRepository";
import OrcamentoRepository from "../domain/repository/OrcamentoRepository";
import PagamentoRepository from "../domain/repository/PagamentoRepository";

import OrcamentoRepositoryMongo, {
  DocumentoOrcamento,
} from "../domain/repository/Mongo/OrcamentoRepositoryMongo";
import PagamentoRepositoryMongo, {
  DocumentoPagamento,
} from "../domain/repository/Mongo/PagamentoRepositoryMongo";
import MensagemProcessadaRepositoryMongo, {
  DocumentoMensagem,
} from "../domain/repository/Mongo/MensagemProcessadaRepositoryMongo";

import OrcamentoRepositoryMemoria from "../domain/repository/Mock/OrcamentoRepositoryMemoria";
import PagamentoRepositoryMemoria from "../domain/repository/Mock/PagamentoRepositoryMemoria";
import MensagemProcessadaRepositoryMemoria from "../domain/repository/Mock/MensagemProcessadaRepositoryMemoria";
import MensageriaGatewayMemoria from "../domain/gateway/Mock/MensageriaGatewayMemoria";
import TelemetriaGatewayMemoria from "../domain/gateway/Mock/TelemetriaGatewayMemoria";
import PagamentoExternoGatewayMemoria from "../domain/gateway/Mock/PagamentoExternoGatewayMemoria";
import MercadoPagoGateway from "../domain/gateway/MercadoPago/MercadoPagoGateway";

import CancelarOrcamentoUseCase from "../domain/usecase/Orcamento/CancelarOrcamentoUseCase";
import ConsultarOrcamentoUseCase from "../domain/usecase/Orcamento/ConsultarOrcamentoUseCase";
import GerarOrcamentoUseCase from "../domain/usecase/Orcamento/GerarOrcamentoUseCase";
import ConsultarPagamentoUseCase from "../domain/usecase/Pagamento/ConsultarPagamentoUseCase";
import EstornarPagamentoUseCase from "../domain/usecase/Pagamento/EstornarPagamentoUseCase";
import RegistrarPagamentoUseCase from "../domain/usecase/Pagamento/RegistrarPagamentoUseCase";

import RabbitMQMensageriaGateway from "./messaging/RabbitMQMensageriaGateway";
import NewRelicTelemetriaGateway from "./telemetry/NewRelicTelemetriaGateway";

export type Container = {
  orcamentoRepository: OrcamentoRepository;
  pagamentoRepository: PagamentoRepository;
  mensagensProcessadas: MensagemProcessadaRepository;
  mensageria: MensageriaGateway;
  telemetria: TelemetriaGateway;
  pagamentoExterno: PagamentoExternoGateway;
  gerarOrcamento: GerarOrcamentoUseCase;
  cancelarOrcamento: CancelarOrcamentoUseCase;
  consultarOrcamento: ConsultarOrcamentoUseCase;
  registrarPagamento: RegistrarPagamentoUseCase;
  estornarPagamento: EstornarPagamentoUseCase;
  consultarPagamento: ConsultarPagamentoUseCase;
};

export type OpcoesContainer = {
  // Sem `db`, o servico roda inteiramente com adaptadores em memoria - e assim
  // que os testes e os cenarios BDD exercitam a Saga sem MongoDB nem RabbitMQ.
  db?: Db;
  mensageria?: MensageriaGateway;
  telemetria?: TelemetriaGateway;
  pagamentoExterno?: PagamentoExternoGateway;
};

// Em local e em demonstracao o provedor de pagamentos e simulado; em hml/prd
// usa-se a API real do Mercado Pago, desde que haja access token.
function escolherPagamentoExterno(): PagamentoExternoGateway {
  const usarMock =
    process.env.MERCADO_PAGO_MOCK === "true" ||
    !process.env.MERCADO_PAGO_ACCESS_TOKEN;

  return usarMock
    ? new PagamentoExternoGatewayMemoria()
    : new MercadoPagoGateway();
}

export function criarContainer(opcoes: OpcoesContainer = {}): Container {
  const usarMongo = Boolean(opcoes.db);

  const orcamentoRepository: OrcamentoRepository = opcoes.db
    ? new OrcamentoRepositoryMongo(
        opcoes.db.collection<DocumentoOrcamento>("orcamentos"),
      )
    : new OrcamentoRepositoryMemoria();

  const pagamentoRepository: PagamentoRepository = opcoes.db
    ? new PagamentoRepositoryMongo(
        opcoes.db.collection<DocumentoPagamento>("pagamentos"),
      )
    : new PagamentoRepositoryMemoria();

  const mensagensProcessadas: MensagemProcessadaRepository = opcoes.db
    ? new MensagemProcessadaRepositoryMongo(
        opcoes.db.collection<DocumentoMensagem>("mensagens_processadas"),
      )
    : new MensagemProcessadaRepositoryMemoria();

  const mensageria: MensageriaGateway =
    opcoes.mensageria ??
    (usarMongo ? new RabbitMQMensageriaGateway() : new MensageriaGatewayMemoria());

  const telemetria: TelemetriaGateway =
    opcoes.telemetria ??
    (usarMongo ? new NewRelicTelemetriaGateway() : new TelemetriaGatewayMemoria());

  const pagamentoExterno: PagamentoExternoGateway =
    opcoes.pagamentoExterno ??
    (usarMongo
      ? escolherPagamentoExterno()
      : new PagamentoExternoGatewayMemoria());

  return {
    orcamentoRepository,
    pagamentoRepository,
    mensagensProcessadas,
    mensageria,
    telemetria,
    pagamentoExterno,
    gerarOrcamento: new GerarOrcamentoUseCase(
      orcamentoRepository,
      mensageria,
      telemetria,
    ),
    cancelarOrcamento: new CancelarOrcamentoUseCase(
      orcamentoRepository,
      mensageria,
      telemetria,
    ),
    consultarOrcamento: new ConsultarOrcamentoUseCase(orcamentoRepository),
    registrarPagamento: new RegistrarPagamentoUseCase(
      pagamentoRepository,
      orcamentoRepository,
      pagamentoExterno,
      mensageria,
      telemetria,
    ),
    estornarPagamento: new EstornarPagamentoUseCase(
      pagamentoRepository,
      pagamentoExterno,
      mensageria,
      telemetria,
    ),
    consultarPagamento: new ConsultarPagamentoUseCase(pagamentoRepository),
  };
}

export default criarContainer;
