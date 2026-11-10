# Reference scenarios for accounts. Accounts are handled by Better Auth in the outer layer,
# not by packages/business. They are listed here because every business rule assumes a session.
Feature: Account

  Scenario: Register
    Given I am not signed in
    When I register with a new email and a password of 8 to 128 characters
    Then my account is created
    And I am not signed in automatically
    And I am taken to the login page

  Scenario Outline: Registration is rejected
    When I register and <problem>
    Then I see an error
    And no account is created

    Examples:
      | problem                              |
      | the password is shorter than 8       |
      | the email is already registered      |

  Scenario: Sign in
    Given an account exists
    When I sign in with the right email and password
    Then I see my library

  Scenario: Wrong credentials
    When I sign in with a wrong password
    Then I see an error
    And I stay on the login page

  Scenario Outline: Protected pages need a session
    Given I am not signed in
    When I open "<page>"
    Then I am taken to the login page

    Examples:
      | page      |
      | /         |
      | /rss      |
      | /settings |

  # CM-OWN-1
  Scenario: Protected API needs a session
    Given I am not signed in
    When I call any library endpoint
    Then the request is rejected as unauthenticated

  # CM-OWN-1
  Scenario: Identity comes only from the session
    Given I am signed in as user A
    When a request names user B as the owner
    Then it is still handled as user A

  Scenario: Sign out
    Given I am signed in
    When I sign out
    Then my session ends and I am taken to the login page

  Scenario: Change password
    Given I am signed in
    When I enter my current password and a valid new password
    Then my password changes
    And I can sign in with the new one

  Scenario: Change password with a wrong current password
    When I enter a wrong current password
    Then the password is not changed
    And I see an error

  Scenario: Not offered
    Then there is no password recovery
    And there is no email verification
    And there is no account deletion
