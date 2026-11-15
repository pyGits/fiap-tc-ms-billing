import { TipoResposta } from "../../src/messaging/contracts";

export type ContextoResposta = {
  sagaId: string;
  ordemServicoId: string;
};

// Porta de saida para a mensageria.
//
// O participante da Saga NAO conhece os outros participantes: ele apenas
// responde ao orquestrador na fila de reply. E isso que mantem o acoplamento
// fraco citado na Aula 2 do SAGA Pattern.
export default interface MensageriaGateway {
  responder(
    ctx: ContextoResposta,
    tipo: TipoResposta,
    body: Record<string, unknown>,
  ): Promise<void>;
}
