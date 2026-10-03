import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/session';
import { PageHeader } from '../../components/PageHeader';

/** Responsável e contato (LGPD). Mudou? Atualize também a data da versão. */
export const LEGAL_CONTACT = 'contato.finappoficial@gmail.com';
const RESPONSIBLE = 'FinApp';
const VERSION = '3 de outubro de 2026';

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  const { data: me } = useMe();
  return (
    <main className={me ? 'legal' : 'legal legal--public'}>
      <PageHeader title={title} back={me ? '/mais' : '/entrar'} />
      <article className="card card--pad legal__body">
        <p className="muted">Versão de {VERSION}.</p>
        {children}
        <p className="muted">
          Dúvidas ou pedidos: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
        </p>
      </article>
      <p className="auth__switch">
        <Link to="/privacidade">Política de privacidade</Link> ·{' '}
        <Link to="/termos">Termos de uso</Link>
      </p>
    </main>
  );
}

/** Política de privacidade (LGPD, Lei 13.709/2018). */
export function PrivacyPage() {
  return (
    <LegalShell title="Política de privacidade">
      <p>
        Esta política explica quais dados o FinApp guarda, para quê e o que você pode fazer com
        eles. O responsável pelos dados (controlador) é o {RESPONSIBLE}, pelo contato{' '}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>

      <h2>Quais dados guardamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> nome, e-mail e senha (guardada só como código irreversível, nunca
          em texto). Se você ligar, também a verificação em duas etapas (cifrada), chaves de acesso
          (passkeys) e o PIN de bloqueio (também irreversível).
        </li>
        <li>
          <strong>O que você cadastra:</strong> contas, cartões, lançamentos, dívidas, metas,
          orçamentos, lembretes, categorias, grupos de racha, comprovantes que você anexar e os
          itens de extratos que você importar.
        </li>
        <li>
          <strong>Uso técnico:</strong> para cada sessão aberta, o endereço IP e o navegador usado
          (segurança e limite de tentativas de login); o histórico de alterações dos espaços (quem
          mudou o quê); e, se você ligar as notificações, o endereço de entrega do seu aparelho.
        </li>
      </ul>
      <p>
        O FinApp <strong>não</strong> acessa seu banco (não usa Open Finance), não usa rastreadores,
        anúncios, análise de comportamento nem inteligência artificial com seus dados. Os únicos
        cookies são os de sessão, necessários para você continuar conectado.
      </p>

      <h2>Para que usamos</h2>
      <p>
        Só para fazer o app funcionar para você: mostrar saldos, previsões, faturas e dívidas,
        mandar os avisos que você escolheu, manter sua conta segura e permitir recuperar a senha. A
        base legal é a execução do serviço que você pediu ao criar a conta (art. 7º, V, da LGPD) e,
        para os registros de segurança, o legítimo interesse (art. 7º, IX).
      </p>

      <h2>Quem vê seus dados</h2>
      <ul>
        <li>
          <strong>Seu espaço pessoal:</strong> só você.
        </li>
        <li>
          <strong>Espaço compartilhado:</strong> todos os membros que você convidou ou aceitou veem
          e editam tudo daquele espaço.
        </li>
        <li>
          <strong>Racha entre amigos:</strong> os participantes do grupo veem as despesas, os
          acertos e os nomes do grupo.
        </li>
      </ul>
      <p>
        Não vendemos nem cedemos seus dados. Alguns serviços participam do funcionamento e podem
        estar fora do Brasil: a Cloudflare (conexão segura entre seu aparelho e o servidor), o
        Google (envio do e-mail de redefinição de senha) e o serviço de notificações do seu aparelho
        (Google, Apple ou Mozilla), que só recebe o texto do aviso.
      </p>

      <h2>Onde e por quanto tempo</h2>
      <p>
        Os dados ficam em servidor próprio do responsável, com conexão sempre criptografada (HTTPS).
        Ficam guardados enquanto sua conta existir. Cópias de segurança são feitas todo dia e as
        mais antigas são apagadas automaticamente: mantemos até 7 diárias, 4 semanais e 12 mensais.
        Por isso, depois de excluída, uma informação pode continuar numa cópia de segurança por até
        12 meses, sem uso.
      </p>

      <h2>Seus direitos</h2>
      <ul>
        <li>
          <strong>Ver e levar seus dados:</strong> Mais › Exportar dados (planilha ou cópia
          completa).
        </li>
        <li>
          <strong>Corrigir:</strong> edite qualquer item direto no app.
        </li>
        <li>
          <strong>Excluir a conta:</strong> Mais › Notificações e configurações › Excluir conta.
          Apaga seu espaço pessoal e tudo dentro dele. Nos espaços de outras pessoas, o que você
          lançou continua lá, sem o seu nome como autor; nos grupos de racha, seu nome continua nas
          despesas do grupo, porque faz parte das contas dos outros participantes.
        </li>
        <li>
          Para qualquer outro pedido (confirmação de tratamento, informação sobre compartilhamento,
          revogação), escreva para <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
          Respondemos em até 15 dias.
        </li>
      </ul>

      <h2>Mudanças</h2>
      <p>
        Se esta política mudar, a data da versão no topo muda e avisamos no app quando a mudança for
        importante.
      </p>
    </LegalShell>
  );
}

/** Termos de uso. */
export function TermsPage() {
  return (
    <LegalShell title="Termos de uso">
      <p>
        Ao criar uma conta no FinApp você concorda com estes termos e com a{' '}
        <Link to="/privacidade">política de privacidade</Link>.
      </p>

      <h2>O que é o FinApp</h2>
      <p>
        Um app gratuito para organizar finanças pessoais: você mesmo cadastra contas, gastos,
        cartões e dívidas, e o app calcula saldos, faturas e previsões. Hoje o acesso é só por
        convite.
      </p>

      <h2>Os números são estimativas</h2>
      <p>
        Previsões, parcelas, juros, correções por índice, simulações e valores de quitação são
        calculados a partir do que você informou e de índices públicos, e podem ser diferentes do
        que o banco, a loja ou a construtora cobram. O FinApp <strong>não é</strong> consultoria
        financeira, contábil ou jurídica: confira sempre com a instituição antes de pagar, quitar ou
        contratar.
      </p>

      <h2>Sua conta</h2>
      <ul>
        <li>Use dados verdadeiros e guarde bem sua senha; não compartilhe sua conta.</li>
        <li>
          Você é responsável pelo que cadastra, inclusive pelo que lança em espaços compartilhados e
          grupos de racha, e por quem convida para eles.
        </li>
        <li>
          Não use o app para nada ilegal nem tente acessar dados de outras pessoas ou atrapalhar o
          serviço.
        </li>
        <li>O FinApp é para maiores de 18 anos ou para quem tem autorização dos responsáveis.</li>
      </ul>

      <h2>Disponibilidade</h2>
      <p>
        Fazemos cópias de segurança diárias e cuidamos da segurança, mas o serviço é oferecido como
        está, sem garantia de funcionar sem interrupções ou sem erros. Mantenha seus próprios
        registros do que for importante (Mais › Exportar dados ajuda). Na medida permitida pela lei,
        o FinApp não responde por decisões tomadas com base nos cálculos do app.
      </p>

      <h2>Encerramento e mudanças</h2>
      <p>
        Você pode excluir sua conta quando quiser, pelo próprio app. Podemos suspender contas que
        violem estes termos. Se os termos mudarem, a data da versão no topo muda e avisamos no app
        quando a mudança for importante. Estes termos seguem as leis do Brasil.
      </p>
    </LegalShell>
  );
}
