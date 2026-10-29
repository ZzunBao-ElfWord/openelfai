/// Customer-facing payment wording. Unknown provider codes stay internal.
class OrderStatusText {
  static String label(String? status) => switch (status) {
        'paid' => '支付成功',
        'pending' => '待付款',
        'closed' => '已关闭',
        'refunded' => '已退款',
        'review' => '核对中',
        'expired' => '已过期',
        'failed' => '支付未完成',
        _ => '结果待确认',
      };

  static String message(String? status) => switch (status) {
        'paid' => '支付成功，余额已更新',
        'pending' => '付款结果待确认，请稍后查询，勿重复付款',
        'closed' => '订单已关闭，如需充值请重新选择金额',
        'refunded' => '订单已退款，请查看退款记录',
        'review' => '付款结果正在核对，请勿重复付款；如有疑问请联系客服',
        'expired' => '订单已过期，如需充值请重新选择金额；已付款请先查询结果',
        'failed' => '本次支付未完成；若已扣款，请先查询结果或联系客服',
        _ => '暂未确认付款结果，请稍后查询或联系客服，勿重复付款',
      };
}
