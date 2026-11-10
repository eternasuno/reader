Feature: Subscription articles
  As a signed-in user
  I want to browse and read articles from my subscriptions
  So that I can keep up with the sources I follow

  Background:
    Given I am signed in
    And I am subscribed to feeds "A" and "B"

  Scenario: List articles from all feeds
    When I open the subscription list
    Then I see articles from all my feeds, newest first

  Scenario: List articles from one feed
    When I select feed "A"
    Then I see only articles from feed "A"

  Scenario Outline: Filter articles by read state
    When I filter by "<filter>"
    Then the list shows <shown> articles

    Examples:
      | filter | shown       |
      | all    | all         |
      | unread | only unread |
      | read   | only read   |

  Scenario: Page through articles and refresh the list
    Given a feed has more articles than fit in one page
    When I scroll to the end
    Then the next page loads without repeats
    When I refresh the list
    Then it is reloaded from the top through the last loaded article

  Scenario: Open an article
    When I open an article
    Then I can read it
    And it is addressed as "/read/feed/:feedId/:key"

  Scenario: Mark articles as read or unread
    When I mark selected articles of feed "A" as read
    Then they show as read
    And the unread count of feed "A" decreases
    When I mark them as unread
    Then they show as unread again

  Scenario: Mark a whole feed as read
    Given feed "A" has unread articles
    When I mark feed "A" as read
    Then all its articles are read
    And its unread count is 0

  Scenario: Mark several feeds as read
    When I mark "A" and "B" as read
    Then all articles of both feeds are read

  Scenario: Mark all subscription articles as read
    When I mark the whole subscription list as read
    Then every article of every subscribed feed is read

  Scenario: Ignore feeds that are not mine when marking read
    Given another user's feed id is included in the request
    When I mark feeds as read
    Then only my own feeds are affected

  Scenario: Article from a feed that does not exist
    When I open an article of a feed I am not subscribed to
    Then I see "Feed not found"

  Scenario: Article that does not exist
    When I open an article id that is not in the feed
    Then I see "Feed item not found"
