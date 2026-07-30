/**
 * manual.js — 「使用说明书」一级入口页面
 * 按用户常用场景（而非菜单目录）组织的图文帮助，含左侧章节目录与真实界面截图。
 */
const Manual = (() => {

  // 截图占位：加载失败自动回退为说明框，保证离线/未截图时手册仍可读
  function shot(key, caption) {
    const alt = caption || '界面示意';
    return `
      <figure class="manual-shot">
        <img src="images/manual/${key}.png?v=20260730a" alt="${alt}"
             loading="lazy"
             onerror="this.style.display='none';this.parentNode.classList.add('shot-missing');this.parentNode.insertAdjacentHTML('beforeend','<div class=&quot;shot-ph&quot;>📷 ${alt}<br><small>截图加载中或暂未采集</small></div>')">
        <figcaption>${caption || ''}</figcaption>
      </figure>`;
  }

  // 提示 / 注意 / 公式 三种 callout
  function tip(t)  { return `<div class="callout tip"><span class="co-ic">💡</span><div>${t}</div></div>`; }
  function warn(w) { return `<div class="callout warn"><span class="co-ic">⚠️</span><div>${w}</div></div>`; }
  function form(f){ return `<div class="callout formula"><span class="co-ic">🧮</span><div>${f}</div></div>`; }

  const TOC = [
    { id: 'ch1', t: '1、新手上路：第一次使用' },
    { id: 'ch2', t: '2、管好客户与合同（前置基础）' },
    { id: 'ch3', t: '3、记好每一笔账（收支管理）' },
    { id: 'ch4', t: '4、商品、服务与库存' },
    { id: 'ch5', t: '5、看清经营状况' },
    { id: 'ch6', t: '6、算清阿米巴的账' },
    { id: 'ch7', t: '7、管人与发薪（员工管理）' },
    { id: 'ch8', t: '8、AI 经营助手提效' },
    { id: 'ch9', t: '9、经营设置' }
  ];

  function render() {
    const el = document.getElementById('page-manual');
    if (!el) return;

    const tocHtml = TOC.map(i => `<li><a href="#${i.id}" data-anchor="${i.id}">${i.t}</a></li>`).join('');

    el.innerHTML = `
      <div class="manual-wrap">
        <aside class="manual-toc">
          <div class="manual-toc-title">目录</div>
          <div class="manual-toc-sub">按场景速查 · 9 章</div>
          <ul>${tocHtml}</ul>
          <div class="manual-toc-foot">遇到问题？右下角 🤖 AI 助手随时可问</div>
        </aside>

        <article class="manual-content">

          <header class="manual-head">
            <h1>阿米巴经营数字助手 · 使用说明书</h1>
            <p class="manual-lead">面向微小企业的阿米巴经营数据记录与分析平台。本手册不按菜单罗列功能，而是按你<strong>日常想完成的事</strong>组织——打开对应场景，照着步骤做即可。推荐顺序：<strong>先建客户与合同（第 ② 章），再记收支账（第 ③ 章）</strong>，因为绝大部分收支都建立在合同关联之上。</p>
          </header>

          <!-- ========== 第 1 章 ========== -->
          <section id="ch1" class="manual-ch">
            <h2>第 1 章 新手上路：第一次使用</h2>
            <p>第一次打开系统，只需 1 分钟就能进入工作状态。</p>

            <h3>1.1 登录</h3>
            <ol>
              <li>在登录页输入<strong>账号</strong>与<strong>密码</strong>，点击「登录」。</li>
              <li>登录成功后自动进入<strong>经营看板</strong>，右上角会显示你的姓名与绑定的企业名称。</li>
            </ol>
            ${warn('账号由系统管理员创建并分配。若提示「用户名或密码错误」，请联系管理员确认账号或重置密码。')}
            ${shot('shot-login', '登录页：输入账号密码进入系统')}

            <h3>1.2 认识界面</h3>
            <p>系统采用「左侧导航 + 中间工作区 + 顶部标题栏」布局：</p>
            <ul>
              <li><strong>左侧导航栏</strong>：所有功能入口，按「经营看板 / 经营分析 / 收支 / 客户 / 商品 / 合同 / 服务 / 库存 / 员工 / 设置 / 账号」分组。</li>
              <li><strong>顶部标题栏</strong>：显示当前页面名称、币种与退出按钮。</li>
              <li><strong>右下角 🤖 悬浮按钮</strong>：随时唤起 AI 经营助手（详见第 ⑧ 章）。</li>
            </ul>
            ${shot('shot-nav', '左侧导航栏：功能分组一目了然')}

            <h3>1.3 找到你要的功能</h3>
            <ol>
              <li>带 <span class="caret">▸</span> 的菜单项可<strong>展开/收起</strong>二级功能（如「收支管理 ▸ 收支录入 / 收支查询」）。</li>
              <li>点击任意菜单项即切换中间工作区，当前项会高亮。</li>
              <li>记不住位置？直接问 AI 助手「帮我打开收支录入」即可跳转。</li>
            </ol>
            ${tip('第一次建议先停留在「经营看板」，它已把最关键的数字汇总好，让你一眼看清今天经营得怎么样。')}
          </section>

          <!-- ========== 第 2 章（前置基础） ========== -->
          <section id="ch2" class="manual-ch">
            <h2>第 2 章 管好客户与合同（前置基础）</h2>
            <p>在记任何一笔账之前，请先在这里把<strong>客户</strong>和<strong>合同</strong>建好。原因很关键：<strong>系统里绝大部分收入和支出，都建立在「与某份合同关联」的基础之上</strong>——合同一旦建立，后续每次收款、付款、回款进度都会自动归集到这份合同，经营看板的应收/应付、合同分析也才有数据。</p>
            ${warn('强烈建议：先完成本章的客户与合同录入，再进入第 ③ 章记收支。没有合同的收支也能录，但无法参与「按合同回款跟踪」，会漏掉大量经营洞察。')}

            <h3>2.1 新增客户</h3>
            <ol>
              <li>左侧导航 <strong>客户管理 ▸ 客户录入</strong>。</li>
              <li>填写<strong>客户名称</strong>（必填）、<strong>客户类型</strong>（个人 / 公司，必填）。</li>
              <li>补充<strong>联系人、电话、地址</strong>等资料，点击「保存客户」。</li>
            </ol>
            ${shot('shot-customer', '客户录入：名称、类型与联系方式')}
            ${warn('同一客户名称不要重复录入；录入时会自动查重提示。')}

            <h3>2.2 查询客户档案</h3>
            <ol>
              <li>左侧导航 <strong>客户管理 ▸ 客户查询</strong>。</li>
              <li>顶部展示<strong>客户总数 / 个人 / 公司</strong>概览，下面是可搜索的客户列表。</li>
              <li>点击「导出当前结果」可导出客户清单。</li>
            </ol>

            <h3>2.3 合同录入与跟踪（核心）</h3>
            <ol>
              <li>左侧导航 <strong>合同管理 ▸ 合同录入</strong>。</li>
              <li>填写<strong>合同名称、关联客户、金额、状态（进行中 / 已完成 / 已取消）、起止日期</strong>与备注。</li>
              <li>在 <strong>合同查询</strong> 中查看每笔合同的<strong>执行率、已回款、未回款</strong>，并按合同名归集。</li>
            </ol>
            ${shot('shot-contract', '合同查询：执行率与未回款一目了然')}
            ${tip('合同金额会进入「应收账款」统计。每当你在第 ③ 章录入一笔「与本合同关联」的收支，这里的已回款/未回款就会自动更新——这正是先把合同建好的价值。')}
            ${form('某合同 未回款 = 合同金额 − 该合同已关联的收款合计')}
          </section>

          <!-- ========== 第 3 章 ========== -->
          <section id="ch3" class="manual-ch">
            <h2>第 3 章 记好每一笔账（收支管理）</h2>
            <p>阿米巴经营的核心就是「把每一笔收支记清楚」。在上一章建好客户与合同后，这里录的每一笔都<strong>可以直接关联它们</strong>，让数据自动成网。</p>

            <h3>3.1 录入一笔收入或支出</h3>
            <ol>
              <li>左侧导航 <strong>收支管理 ▸ 收支录入</strong>。</li>
              <li>选择方向：<strong>收入</strong> 或 <strong>支出</strong>。</li>
              <li>填写<strong>金额</strong>（必填），选择<strong>收支类型</strong>。</li>
              <li>在「客户」框中<strong>搜索并选择</strong>对应客户（建议关联，便于按客户统计应收）。</li>
              <li>对于<strong>购销类</strong>收支，表单会自动出现「关联合同」框：收入方向选<strong>销售合同</strong>、支出方向选<strong>采购合同</strong>。选好后，该合同的已回款/未回款会自动累计（见第 ② 章）。</li>
              <li>若启用了<strong>部门独立核算</strong>，选择归属<strong>部门</strong>。</li>
              <li>填写<strong>日期</strong>与<strong>备注</strong>，点击「提交录入」。</li>
            </ol>
            ${shot('shot-entry-add', '收支录入：选择方向、类型、关联客户与合同')}
            ${warn('「关联合同」框仅对购销类业务显示——收入方向的「销售收入 / 现金收入」、支出方向的「材料采购 / 委托加工 / 现金支出」五类需要关联；杂费、税金、其他等类别无需、也不会出现合同关联。一笔收支只能选一种方向，金额填正数。')}
            ${tip('记收款时关联合同，是跟进「谁还欠我们多少钱」最省力的方式：合同查询页据此算出未回款，无需手工对账。')}

            <h3>3.2 查询与筛选</h3>
            <ol>
              <li>左侧导航 <strong>收支管理 ▸ 收支查询</strong>。</li>
              <li>按<strong>客户名称 / 合同 / 收支类型 / 日期范围 / 部门</strong>组合筛选。</li>
              <li>列表实时更新，可查看每笔的明细与合计；未关联合同的购销记录会高亮提醒。</li>
            </ol>
            ${shot('shot-entry-query', '收支查询：多条件筛选与合计')}

            <h3>3.3 忘了关联？一键补上</h3>
            <p>如果某笔购销类收支录入时没选合同，<strong>收支查询</strong>列表会在该行给出「⚠ 该笔交易记录还未关联合同」提示。</p>
            <ol>
              <li>点击该行的「关联」按钮，系统按<strong>方向 + 客户 + 日期相近</strong>推荐候选合同。</li>
              <li>从候选列表选一个，即可一键补上关联，合同回款进度同步更新。</li>
            </ol>
            ${tip('这正是「合同前置」的价值：哪怕先记了账，也能回过头快速补关联，不让任何一笔购销业务游离在合同跟踪之外。')}

            <h3>3.4 导出 Excel</h3>
            <ol>
              <li>在查询页设置好筛选条件后，点击右上角 <strong>「导出当前结果」</strong>。</li>
              <li>系统按当前筛选结果生成 Excel，便于报账或留存。</li>
            </ol>
            ${tip('导出的字段与当前列表一致；想导出全部，先把筛选条件清空再导出。')}
          </section>

          <!-- ========== 第 4 章 ========== -->
          <section id="ch4" class="manual-ch">
            <h2>第 4 章 商品、服务与库存</h2>
            <p>三类基础资料，支撑采购、销售与库存核算。</p>

            <h3>4.1 商品管理</h3>
            <ol>
              <li><strong>商品管理 ▸ 商品录入</strong>：填写商品名称、品牌、单位、分类、采购价、售价后保存。</li>
              <li><strong>商品管理 ▸ 商品查询</strong>：按名称/分类搜索，查看进销价与导出清单。</li>
            </ol>
            ${shot('shot-product', '商品录入：名称、分类与进销价')}
            ${tip('系统已预置服装等行业默认商品分类，可直接选用；也可在经营设置中自定义。')}

            <h3>4.2 服务管理</h3>
            <ol>
              <li>左侧导航 <strong>服务管理</strong>：维护你提供的服务项（如咨询、维修），用于区分于实物商品。</li>
            </ol>
            ${shot('shot-service', '服务管理：维护服务型业务')}

            <h3>4.3 库存管理</h3>
            <ol>
              <li>左侧导航 <strong>库存管理</strong>：查看当前库存数量与均价，支持按商品搜索。</li>
            </ol>
            ${shot('shot-inventory', '库存管理：数量与均价查询')}
            ${warn('库存为查询视图，出入库数量随收支/采购业务联动更新；如数据异常，请核对对应收支单据。')}
          </section>

          <!-- ========== 第 5 章 ========== -->
          <section id="ch5" class="manual-ch">
            <h2>第 5 章 看清经营状况</h2>
            <p>数据录进来之后，怎么看？两套视图帮你从「概览」到「下钻」。</p>

            <h3>5.1 经营看板（首页）</h3>
            <p>登录后默认页面，已把最关键指标汇总好：</p>
            <ul>
              <li><strong>阿米巴核心指标</strong>：附加价值、边界利润、边界利润率、总工资。</li>
              <li><strong>经营收支概览</strong>：总收入、消费支出、杂费支出。</li>
              <li><strong>预警</strong>：超期应收、异常费用等自动提醒。</li>
            </ul>
            ${shot('shot-dashboard', '经营看板：核心指标与预警总览')}
            ${form('附加价值 = 总收入 − 消费支出 − 杂费支出　（阿米巴创造的新价值，是核心中的核心）')}
            ${tip('把鼠标悬停在指标上的「?」可查看该指标的计算口径。')}

            <h3>5.2 经营分析（六大维度）</h3>
            <p>左侧导航 <strong>经营分析</strong> 下可展开六个维度，均有图表与明细：</p>
            <ul>
              <li><strong>经营总览</strong>：收入/支出趋势与结构。</li>
              <li><strong>客户分析</strong>：销售额、回款、应收账龄，识别高价值/高风险客户。</li>
              <li><strong>商品分析</strong>：各商品销量与利润贡献。</li>
              <li><strong>合同分析</strong>：合同金额、已回款、执行率（源自第 ② 章录入的合同与收款）。</li>
              <li><strong>费用分析</strong>：按类型归集的费用分布。</li>
              <li><strong>资金分析</strong>：应收/应付、账龄与资金健康度。</li>
            </ul>
            ${shot('shot-analysis', '客户分析：销售额、回款与应收账龄示例')}
            ${tip('点击图表或表格中的客户/合同名，可一键跳转到对应明细并高亮该行。')}
          </section>

          <!-- ========== 第 6 章 ========== -->
          <section id="ch6" class="manual-ch">
            <h2>第 6 章 算清阿米巴的账</h2>
            <p>阿米巴经营的精髓：把组织拆成多个小单元，分别算账、分别看贡献。</p>

            <h3>6.1 开启部门独立核算</h3>
            <ol>
              <li>左侧导航 <strong>经营设置 ▸ 部门设置</strong>，先建好部门（如销售部、生产部）。</li>
              <li>在设置中开启<strong>「部门独立核算」</strong>开关。</li>
              <li>开启后，录入收支时需选择归属部门，看板与分析即可按部门拆分。</li>
            </ol>
            ${shot('shot-dept', '部门独立核算：建部门并开启开关')}
            ${warn('开启独立核算后，历史未分配部门的收支会归入「未分配」，建议在期初就规范录入。')}

            <h3>6.2 核算口径（务必理解）</h3>
            ${form('附加价值 = 总收入 − 消费支出 − 杂费支出')}
            ${form('边界利润 = 附加价值 − 部门人工成本（若有）')}
            ${warn('在阿米巴体系中，<strong>员工工资不计入「经营支出」</strong>——它是经营成果由全员共享的对象，而非衡量盈亏的成本。看板单独列出「总工资」以作区分。')}
            <p>这样每个部门都能看到自己创造的「附加价值」，据此评价贡献、分配成果。</p>
          </section>

          <!-- ========== 第 7 章 ========== -->
          <section id="ch7" class="manual-ch">
            <h2>第 7 章 管人与发薪（员工管理）</h2>
            <p>员工是阿米巴的成员，工资是共享的成果，这里只做信息维护与核算，不计入经营支出。</p>

            <h3>7.1 维护员工信息</h3>
            <ol>
              <li>左侧导航 <strong>员工管理 ▸ 员工信息</strong>。</li>
              <li>录入<strong>姓名、所属部门、时薪、入职日期、在职状态</strong>等。</li>
            </ol>
            ${shot('shot-emp', '员工信息：姓名、部门、时薪与状态')}

            <h3>7.2 记录入离职</h3>
            <ol>
              <li><strong>员工管理 ▸ 员工入离职记录</strong>：登记入职/离职事件与日期，形成员工生命周期档案。</li>
            </ol>

            <h3>7.3 工时与工资</h3>
            <ol>
              <li><strong>员工管理 ▸ 工时与工资</strong>：逐月录入工时。</li>
              <li>系统按 <strong>工资 = 工时 × 时薪</strong> 自动汇总，并在看板「总工资」中体现。</li>
            </ol>
            ${form('总工资 = Σ(工时 × 时薪)')}
            ${tip('工时按月在员工状态历史中判定「在岗」，便于精确核算某月应发工资。')}
          </section>

          <!-- ========== 第 8 章 ========== -->
          <section id="ch8" class="manual-ch">
            <h2>第 8 章 AI 经营助手提效</h2>
            <p>不想翻菜单？直接用自然语言问它。</p>

            <h3>8.1 唤起与对话</h3>
            <ol>
              <li>点击界面<strong>右下角 🤖 悬浮按钮</strong>，打开 AI 对话面板。</li>
              <li>在输入框输入问题，回车发送；点 🗑 清空对话，点 × 关闭面板。</li>
            </ol>
            ${shot('shot-ai', 'AI 经营助手：对话面板与快捷指令')}

            <h3>8.2 常用问法（直接复制）</h3>
            <ul>
              <li>「这个月的经营情况怎么样？」→ 本月经营概况</li>
              <li>「帮我查看所有客户列表」→ 客户清单</li>
              <li>「本月有哪些支出？按类型汇总」→ 支出汇总</li>
              <li>「哪些客户还有应收款？」→ 应收账款清单</li>
              <li>「帮我看看库存情况」→ 库存查询</li>
              <li>「打开收支录入」→ 直接跳转对应页面</li>
            </ul>
            ${tip('面板里也内置了「快捷指令」按钮，点一下即可发送，不用自己打字。')}
            ${warn('AI 基于你账号下的真实数据回答；涉及金额的决策建议仍以看板/分析为准二次确认。')}

            <h3>8.3 它能做什么</h3>
            <p>查数据、做汇总、解释指标含义、帮你跳转功能页。复杂操作（如导出、改设置）仍建议在对应页面完成。</p>
          </section>

          <!-- ========== 第 9 章 ========== -->
          <section id="ch9" class="manual-ch">
            <h2>第 9 章 经营设置</h2>
            <p>在使用系统前，建议先根据企业实际情况配置好基础数据，后续录入和分析才会更顺手。</p>

            <h3>9.1 部门设置</h3>
            <ol>
              <li>左侧导航 <strong>经营设置 ▸ 部门设置</strong>。</li>
              <li>添加企业内部的部门名称（如销售部、生产部、财务部）。</li>
              <li>开启<strong>「部门独立核算」</strong>后，录入收支时可选择归属部门，看板与分析即可按部门拆分经营成果。</li>
            </ol>
            ${shot('shot-dept', '部门设置：增删部门与独立核算开关')}
            ${warn('开启独立核算后，历史未分配部门的收支会归入「未分配」，建议在期初就规范录入。')}

            <h3>9.2 收支类型</h3>
            <ol>
              <li>左侧导航 <strong>经营设置 ▸ 收支类型</strong>。</li>
              <li>自定义收入/支出类型（如销售收款、材料采购、房租、差旅费）。</li>
              <li>可设置类型是否关联客户、商品、加工或杂费细分，以适应不同业务场景。</li>
            </ol>
            ${shot('shot-settings', '收支类型设置：自定义类型与关联规则')}

            <h3>9.3 杂费类别设置</h3>
            <ol>
              <li>左侧导航 <strong>经营设置 ▸ 杂费类别设置</strong>。</li>
              <li>维护杂费类别（如办公费、水电费、市场推广费）。</li>
              <li>录入「杂费支出」时选择对应类别，费用分析即可按类别归集。</li>
            </ol>

            <h3>9.4 显示与导出设置</h3>
            <ol>
              <li>左侧导航 <strong>经营设置 ▸ 显示与导出设置</strong>。</li>
              <li>设置默认币种（¥ / $ / €）、导出字段、页面显示偏好等。</li>
              <li>设置后会影响看板、列表和导出 Excel 的展示。</li>
            </ol>
            ${tip('建议先完成部门、收支类型、杂费类别的配置，再开始大量录入数据；显示与导出设置可随时调整。')}

            <div class="manual-end">— 手册完 · 更多问题随时问右下角 AI 经营助手 —</div>
          </section>

        </article>
      </div>`;

    // 目录点击平滑滚动到对应章节（在页面容器内滚动）
    el.querySelectorAll('.manual-toc a[data-anchor]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = el.querySelector('#' + a.dataset.anchor);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  return { render };
})();
