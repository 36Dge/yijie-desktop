# FEAT-164 草案提交状态的只读修复

2026-10-25，contract-impact=semantic；沿用Owner持续授权的FEAT-164修复、安全离线验证和本地提交。总需求breaking不变。只修复Desktop私有历史读取到Renderer的既有状态解释，不改Host/Runtime、共享wire、command、schema或授权。

权威源为Desktop 277f59eeef538d159e43bb1570767ca4f2f5f72a的SQL22草案来源/attempt事实和私有`src-tauri/schemas/chat-native-conversation-v4.schema.json`的LocalSubmissionView（queued/submitted/failed/uncertain/cancelled）。公共Contracts仍1b357cce0575c492f3715b316ee5f254051acf80；新契约版本/tag/generator N/A，没有新形状。Owner/唯一consumer为段成威/Client Team下的同源Desktop Renderer；本地持续授权不代表独立人工复审或发布。

问题：草案create_session已尝试且outbox failed、Host绑定未确认，原chat_turns仍queued。原读投影显示“等待提交”是不完整的事实。选择只读投影修复；拒绝把持久行改failed/never-sent或用404证明未发。仅当既有草案身份、scope、用途/版本和create引用匹配、create_attempted=1、create outbox failed、原turn无Runtime绑定且缺Host绑定时，将原queued投影为既有uncertain。没有attempt证明、正常pending、已绑定或终态记录保持原状态。只读查证不创建计划、grant或发送资格。

UI继续使用原生状态；仅当前source/聊天/turn均匹配的uncertain给出“结果尚未确认；先核对原请求，勿重复提交或另建相同计划”的解释。刷新保持只读；“检查并继续”仍经原确认和Native恢复/最后发送检查，missing/404仍拒绝，不以UI状态放宽规则。状态未知时继续保留记录，不提供重置、删除或自动重发作为恢复手段。正常可验证mapping到达后仍由原恢复路径决定是否允许继续尚未尝试的turn。

兼容：现有v1-v4 consumer已识别uncertain；旧数据仅多一个更保守的读取投影，原SQL/native事实逐字保留；不提高存储版本，不回填旧证明。回退至277兼容读取原数据但会再次显示旧queued提示，不应为恢复而重发。部署顺序同源Native+Renderer构建；无独立producer激活。public/production资格N/A，本轮仅本地。

验证：正常临时SQLCipher通过产品accept/claim/attempt/fail记录API建立结构化状态，不制造进程/网络故障；重复读取零写入、跨scope拒绝、未尝试/pending/已绑定不误判、原continue拒绝和晚到合法mapping恢复。前端回归验证绑定隔离/只读刷新；同源App读取上轮自然形成的旧失败草稿，0新增模型请求；所有App正常退出。亮暗和最小窗口按实际能力记录。未做任何攻击/故障注入或数据库手工修复。
